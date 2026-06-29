"""Looping clip playback for a single lane (`VideoLoop`).

A `VideoLoop` wraps a video capture for one lane's `lane_{id}.mp4` clip and
exposes a `read_frame()` method that returns frames sequentially. When the
underlying capture reaches end-of-file (EOF), the loop seeks back to frame 0
and continues, so playback repeats forever (Requirement 1.2).

Design notes:
  - OpenCV (`cv2`) is imported lazily and guarded so this module can be
    imported, and the loop/seek logic unit-tested, without OpenCV installed
    (mirrors the dependency-light pattern used by `app.config`).
  - Construction never raises. If the clip is missing or the capture cannot be
    opened, the instance surfaces this via `is_open` / `opened` and an
    `error` object that identifies the affected lane. Per-lane error *reporting*
    in the detection endpoints is task 7.7; `VideoLoop` only exposes openability
    so that layer can build on it (Requirements 1.1, 1.3, 1.4 groundwork).

The capture object is abstracted behind a tiny protocol so tests can inject a
synthetic stub instead of a real `cv2.VideoCapture` (no real mp4 or OpenCV
required).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

# cv2 property id for the next frame position. Mirrors cv2.CAP_PROP_POS_FRAMES
# (value 1 in OpenCV) so the seek works identically whether we received a real
# capture or a stub, and without importing cv2 at module load time.
CAP_PROP_POS_FRAMES = 1


class FrameCapture(Protocol):
    """Minimal structural interface a capture must satisfy.

    `cv2.VideoCapture` already satisfies this protocol, and tests provide a
    lightweight stub with the same surface.
    """

    def isOpened(self) -> bool:  # noqa: N802 - matches cv2 naming
        ...

    def read(self) -> tuple[bool, Any]:
        """Return (ok, frame). `ok` is False at EOF or on a read failure."""
        ...

    def set(self, prop_id: int, value: float) -> bool:
        """Set a capture property (used to seek to frame 0)."""
        ...

    def release(self) -> None:
        ...


@dataclass(frozen=True)
class CaptureError:
    """A clear, lane-identifying error state for an unopenable clip."""

    code: str
    message: str
    lane_id: int

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "lane_id": self.lane_id}


def _open_cv2_capture(path: str) -> Optional[FrameCapture]:
    """Open a real `cv2.VideoCapture`, importing cv2 lazily.

    Returns the capture if OpenCV is available and the file opened, otherwise
    ``None``. Never raises: a missing OpenCV install or an unopenable file are
    both treated as "not opened" so the caller can record an error state.
    """
    try:
        import cv2  # type: ignore  # lazy/guarded import
    except Exception:  # pragma: no cover - exercised only without OpenCV
        return None

    try:
        capture = cv2.VideoCapture(path)
    except Exception:  # pragma: no cover - defensive; cv2 ctor rarely raises
        return None

    if capture is None or not capture.isOpened():
        return None
    return capture


class VideoLoop:
    """Continuously-looping frame reader for a single lane's clip.

    Parameters
    ----------
    lane_id:
        System lane id (0..3) this loop serves; used in error reporting.
    clip_path:
        Filesystem path to the lane's `lane_{id}.mp4` clip.
    capture:
        Optional pre-built capture (used by tests with a synthetic stub). When
        omitted, a real `cv2.VideoCapture` is opened lazily.
    capture_factory:
        Optional callable that builds a capture from a path. Defaults to the
        guarded `cv2` opener. Lets tests inject a factory without a real file.
    """

    def __init__(
        self,
        lane_id: int,
        clip_path: str | Path,
        *,
        capture: Optional[FrameCapture] = None,
        capture_factory: Optional[Callable[[str], Optional[FrameCapture]]] = None,
    ) -> None:
        self.lane_id = lane_id
        self.clip_path = str(clip_path)
        self._capture: Optional[FrameCapture] = None
        self._error: Optional[CaptureError] = None
        self._frames_read = 0
        self._loops = 0

        if capture is not None:
            self._capture = capture
            if not self._safe_is_opened(capture):
                self._capture = None
                self._set_open_error()
            return

        factory = capture_factory or _open_cv2_capture
        # A missing file is a clear, lane-identifying error; don't even try to
        # open it so the message is specific (Requirement 1.4 groundwork).
        if not Path(self.clip_path).is_file():
            self._set_missing_error()
            return

        built = factory(self.clip_path)
        if built is None:
            self._set_open_error()
            return
        self._capture = built

    # --- openability / error surface -------------------------------------

    @property
    def opened(self) -> bool:
        """True when a usable capture is available."""
        return self._capture is not None

    def is_open(self) -> bool:
        """Method form of `opened` for callers that prefer a call."""
        return self.opened

    @property
    def error(self) -> Optional[CaptureError]:
        """The lane-identifying error state, or None when the clip opened."""
        return self._error

    @property
    def frames_read(self) -> int:
        """Total frames returned by `read_frame()` so far (diagnostic)."""
        return self._frames_read

    @property
    def loops(self) -> int:
        """Number of times playback has wrapped from EOF back to frame 0."""
        return self._loops

    # --- playback --------------------------------------------------------

    def read_frame(self) -> Optional[Any]:
        """Return the next frame, looping back to frame 0 at EOF.

        Returns ``None`` when the clip is not open. When the underlying capture
        reports EOF, this seeks to frame 0 (`CAP_PROP_POS_FRAMES = 0`) and reads
        again so playback continues seamlessly (Requirement 1.2). If the capture
        still cannot produce a frame after a rewind (e.g. an empty/corrupt
        clip), an error state is recorded and ``None`` is returned to avoid an
        infinite loop.
        """
        if self._capture is None:
            return None

        ok, frame = self._capture.read()
        if not ok:
            # EOF (or transient read failure): rewind to the first frame and
            # try once more so the clip loops continuously.
            self._seek_to_start()
            self._loops += 1
            ok, frame = self._capture.read()
            if not ok:
                # A rewound clip that still yields nothing is unusable.
                self._set_error(
                    "CLIP_READ_FAILED",
                    f"lane_{self.lane_id} clip produced no frames after rewind: {self.clip_path}",
                )
                self._capture = None
                return None

        self._frames_read += 1
        return frame

    def release(self) -> None:
        """Release the underlying capture, if any."""
        if self._capture is not None:
            try:
                self._capture.release()
            except Exception:  # pragma: no cover - defensive cleanup
                pass
            self._capture = None

    # --- internals -------------------------------------------------------

    def _seek_to_start(self) -> None:
        if self._capture is None:
            return
        try:
            self._capture.set(CAP_PROP_POS_FRAMES, 0)
        except Exception:  # pragma: no cover - defensive; stubs/cv2 shouldn't raise
            pass

    @staticmethod
    def _safe_is_opened(capture: FrameCapture) -> bool:
        try:
            return bool(capture.isOpened())
        except Exception:  # pragma: no cover - defensive
            return False

    def _set_missing_error(self) -> None:
        self._set_error(
            "CLIP_OPEN_FAILED",
            f"lane_{self.lane_id} clip not found: {self.clip_path}",
        )

    def _set_open_error(self) -> None:
        self._set_error(
            "CLIP_OPEN_FAILED",
            f"lane_{self.lane_id} clip could not be opened: {self.clip_path}",
        )

    def _set_error(self, code: str, message: str) -> None:
        self._error = CaptureError(code=code, message=message, lane_id=self.lane_id)

    # --- context manager convenience ------------------------------------

    def __enter__(self) -> "VideoLoop":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.release()
