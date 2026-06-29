"""Annotated-overlay rendering and JPEG encoding for the detector service.

This module implements the overlay step of the detector pipeline (design:
Python CV Microservice -> internal pipeline step 6, Requirement 9). It draws
bounding boxes + class labels onto a frame and encodes the result to JPEG bytes
for the overlay endpoints (``GET /lanes/{laneId}/frame`` and
``GET /lanes/{laneId}/mjpeg``).

Like the rest of the pipeline, OpenCV (``cv2``) is imported **lazily and
guarded** so this module imports cleanly in a bare environment (no ``cv2`` /
``numpy`` installed) and the unit tests run stdlib-only. When ``cv2`` or a frame
is unavailable the rendering degrades gracefully: a small, valid placeholder
JPEG is returned instead of raising. This keeps the overlay endpoints serving a
valid ``image/jpeg`` payload even when clips/OpenCV are missing (Requirements
9.1, 9.2, 9.4; 9.3 placeholder fallback).

Public surface:
  * :func:`draw_detections`     — draw boxes + labels onto a frame (needs cv2).
  * :func:`encode_jpeg`         — encode a frame to JPEG bytes (needs cv2).
  * :func:`render_annotated_jpeg` — frame + detections -> JPEG bytes, always
    returning a valid payload (placeholder when cv2 / frame unavailable).
  * :func:`placeholder_jpeg`    — the minimal valid placeholder JPEG bytes.
  * :func:`mjpeg_chunk`         — wrap a JPEG in one multipart MJPEG part.

Requirements:
  - 9.1 / 9.2: serve annotated JPEG frames (bounding boxes + class labels).
  - 9.4: serve an MJPEG overlay stream built from those frames.
"""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional

# Multipart boundary used by the MJPEG (`multipart/x-mixed-replace`) stream.
MJPEG_BOUNDARY = "nexusframe"

# Per-class annotation colours in BGR (OpenCV order). Unknown classes fall back
# to white. Mirrors the Vehicle_Class set {car, bike, truck, bus}.
_CLASS_COLORS: Dict[str, tuple[int, int, int]] = {
    "car": (0, 200, 0),      # green
    "bike": (0, 200, 200),   # yellow
    "truck": (200, 120, 0),  # blue-ish
    "bus": (0, 0, 200),      # red
}
_DEFAULT_COLOR = (255, 255, 255)

# A minimal, valid 1x1 JPEG used as the graceful-degradation placeholder when
# OpenCV or a frame is unavailable. Decoded once at import; it begins with the
# JPEG SOI marker (0xFFD8) and ends with EOI (0xFFD9) so it is a well-formed
# ``image/jpeg`` payload.
_PLACEHOLDER_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB"
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgARCAABAAEDAREAAhEBAxEB/8QAFAAB"
    "AAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAUf/xAAU"
    "EAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAED"
    "AQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAA"
    "AAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgAD"
    "AAAAEAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAA"
    "AAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q=="
)
PLACEHOLDER_JPEG: bytes = base64.b64decode(_PLACEHOLDER_JPEG_B64)


def _load_cv2() -> Optional[Any]:
    """Import ``cv2`` lazily, returning the module or ``None`` if unavailable.

    Never raises: a missing OpenCV install is treated as "not available" so
    callers can fall back to the placeholder payload.
    """
    try:
        import cv2  # type: ignore  # lazy/guarded import
    except Exception:  # pragma: no cover - exercised only without OpenCV
        return None
    return cv2


def cv2_available() -> bool:
    """Return ``True`` when OpenCV can be imported in this environment."""
    return _load_cv2() is not None


def placeholder_jpeg() -> bytes:
    """Return the minimal valid placeholder JPEG bytes (graceful degradation)."""
    return PLACEHOLDER_JPEG


def _bbox_corners(bbox: Any) -> Optional[tuple[int, int, int, int]]:
    """Convert an ``[x, y, w, h]`` bbox to integer ``(x1, y1, x2, y2)`` corners."""
    try:
        x, y, w, h = (float(bbox[i]) for i in range(4))
    except (TypeError, KeyError, IndexError, ValueError):
        return None
    x1 = int(round(x))
    y1 = int(round(y))
    x2 = int(round(x + w))
    y2 = int(round(y + h))
    return x1, y1, x2, y2


def _label_text(detection: Dict[str, Any]) -> str:
    """Build the ``class conf`` label text for a detection."""
    class_name = str(detection.get("class_name", "")) if isinstance(detection, dict) else ""
    confidence = detection.get("confidence") if isinstance(detection, dict) else None
    if isinstance(confidence, (int, float)):
        return f"{class_name} {float(confidence):.2f}".strip()
    return class_name


def draw_detections(frame: Any, detections: List[Dict[str, Any]], cv2: Any = None) -> Any:
    """Draw bounding boxes + class labels onto a copy of ``frame``.

    Requires OpenCV. Each detection is expected to be a dict shaped like
    ``{class_name, bbox: [x, y, w, h], confidence}`` (as produced by
    :class:`app.detector.Detector`). Boxes are coloured per Vehicle_Class and
    labelled with the class name and confidence (Requirement 9.2).

    Args:
        frame: The source frame (an OpenCV/numpy BGR ``ndarray``).
        detections: Detections to annotate; an empty list draws nothing.
        cv2: Optional pre-imported cv2 module (the caller may pass it to avoid a
            second import). When ``None`` it is imported lazily.

    Returns:
        An annotated copy of the frame. If ``cv2`` is unavailable the original
        frame is returned unchanged (the caller then falls back to a placeholder).
    """
    module = cv2 if cv2 is not None else _load_cv2()
    if module is None:
        return frame

    try:
        annotated = frame.copy()
    except Exception:  # pragma: no cover - non-numpy frame; nothing to draw
        annotated = frame

    for det in detections or []:
        if not isinstance(det, dict):
            continue
        corners = _bbox_corners(det.get("bbox"))
        if corners is None:
            continue
        x1, y1, x2, y2 = corners
        color = _CLASS_COLORS.get(det.get("class_name"), _DEFAULT_COLOR)
        try:
            module.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            label = _label_text(det)
            if label:
                module.putText(
                    annotated,
                    label,
                    (x1, max(0, y1 - 6)),
                    module.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    color,
                    1,
                    module.LINE_AA,
                )
        except Exception:  # pragma: no cover - defensive against odd frames
            continue

    return annotated


def _downscale(frame: Any, cv2: Any, max_width: int) -> Any:
    """Downscale a frame to ``max_width`` (preserving aspect), if wider."""
    if max_width is None or max_width <= 0:
        return frame
    shape = getattr(frame, "shape", None)
    if shape is None:
        return frame
    try:
        height = int(shape[0])
        width = int(shape[1])
    except (TypeError, IndexError, ValueError):
        return frame
    if width <= max_width or width <= 0:
        return frame
    scale = max_width / float(width)
    new_size = (max_width, max(1, int(round(height * scale))))
    try:
        return cv2.resize(frame, new_size, interpolation=cv2.INTER_AREA)
    except Exception:  # pragma: no cover - defensive
        return frame


def encode_jpeg(
    frame: Any,
    cv2: Any = None,
    *,
    max_width: Optional[int] = None,
    quality: Optional[int] = None,
) -> Optional[bytes]:
    """Encode a frame to JPEG bytes via ``cv2.imencode``.

    Optionally downscales the frame to ``max_width`` and applies a JPEG
    ``quality`` to keep overlay payloads small (smoother streaming).

    Args:
        frame: The frame to encode (an OpenCV/numpy BGR ``ndarray``).
        cv2: Optional pre-imported cv2 module.
        max_width: If set and the frame is wider, downscale to this width.
        quality: If set, JPEG quality (0-100); lower = smaller/faster.

    Returns:
        The JPEG bytes, or ``None`` when OpenCV is unavailable, the frame is
        ``None``, or encoding fails (the caller falls back to a placeholder).
    """
    if frame is None:
        return None
    module = cv2 if cv2 is not None else _load_cv2()
    if module is None:
        return None
    if max_width:
        frame = _downscale(frame, module, max_width)
    params: list[int] = []
    if quality is not None:
        params = [int(module.IMWRITE_JPEG_QUALITY), int(quality)]
    try:
        ok, buffer = module.imencode(".jpg", frame, params)
    except Exception:  # pragma: no cover - defensive against odd frames
        return None
    if not ok:
        return None
    try:
        return bytes(buffer.tobytes())
    except Exception:  # pragma: no cover - buffer should expose tobytes()
        try:
            return bytes(buffer)
        except Exception:
            return None


def render_annotated_jpeg(frame: Any, detections: Optional[List[Dict[str, Any]]]) -> bytes:
    """Render a frame + detections to JPEG bytes, always returning valid bytes.

    This is the single entry point the endpoints use. It draws the detections
    onto the frame and encodes it to JPEG. If OpenCV is unavailable, the frame is
    ``None``, or any step fails, it returns the minimal placeholder JPEG so the
    endpoint still serves a valid ``image/jpeg`` payload (Requirements 9.1, 9.2;
    graceful degradation per 9.3).

    Args:
        frame: The current frame for the lane, or ``None`` when unavailable.
        detections: The detections to annotate (``None``/empty draws nothing).

    Returns:
        JPEG-encoded bytes — the annotated frame when possible, otherwise the
        placeholder.
    """
    cv2 = _load_cv2()
    if cv2 is None or frame is None:
        return placeholder_jpeg()

    # Pull overlay tuning (downscale width + JPEG quality) from config so the
    # streamed frames stay small and smooth. Falls back to sane defaults.
    try:
        from app.config import config as _cfg
        max_width = int(getattr(_cfg, "overlay_max_width", 854) or 0)
        quality = int(getattr(_cfg, "overlay_jpeg_quality", 70) or 70)
    except Exception:  # pragma: no cover - config always importable
        max_width, quality = 854, 70

    annotated = draw_detections(frame, detections or [], cv2=cv2)
    encoded = encode_jpeg(annotated, cv2=cv2, max_width=max_width, quality=quality)
    if encoded is None:
        return placeholder_jpeg()
    return encoded


def mjpeg_chunk(jpeg: bytes, boundary: str = MJPEG_BOUNDARY) -> bytes:
    """Wrap a single JPEG frame as one part of a ``multipart/x-mixed-replace`` MJPEG stream."""
    head = (
        f"--{boundary}\r\n"
        "Content-Type: image/jpeg\r\n"
        f"Content-Length: {len(jpeg)}\r\n\r\n"
    ).encode("ascii")
    return head + jpeg + b"\r\n"
