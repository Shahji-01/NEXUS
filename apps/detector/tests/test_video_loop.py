"""Tests for looping clip playback (`VideoLoop`).

These exercise the loop/seek logic with a tiny synthetic capture stub, so they
require neither real mp4 clips nor OpenCV (stdlib-only).

Requirements:
  - 1.1 / 1.3: one clip per lane, associated with a lane id.
  - 1.2: at EOF the loop rewinds to frame 0 and keeps playing.
"""

from __future__ import annotations

from app.video_loop import CAP_PROP_POS_FRAMES, VideoLoop


class StubCapture:
    """A synthetic cv2.VideoCapture-like object backed by an in-memory list.

    `read()` returns frames sequentially and (ok=False, None) at EOF. `set()`
    with CAP_PROP_POS_FRAMES rewinds the read cursor, mirroring how a real
    capture seeks back to frame 0.
    """

    def __init__(self, frames, opened=True):
        self._frames = list(frames)
        self._pos = 0
        self._opened = opened
        self.set_calls: list[tuple[int, float]] = []
        self.released = False

    def isOpened(self):  # noqa: N802 - matches cv2 naming
        return self._opened

    def read(self):
        if self._pos >= len(self._frames):
            return False, None
        frame = self._frames[self._pos]
        self._pos += 1
        return True, frame

    def set(self, prop_id, value):
        self.set_calls.append((prop_id, value))
        if prop_id == CAP_PROP_POS_FRAMES:
            self._pos = int(value)
        return True

    def release(self):
        self.released = True


def _loop_with(frames, **kwargs):
    cap = StubCapture(frames)
    loop = VideoLoop(0, "clips/lane_0.mp4", capture=cap, **kwargs)
    return loop, cap


def test_reads_frames_in_order():
    loop, _ = _loop_with(["a", "b", "c"])
    assert loop.opened is True
    assert loop.is_open() is True
    assert loop.read_frame() == "a"
    assert loop.read_frame() == "b"
    assert loop.read_frame() == "c"
    assert loop.frames_read == 3


def test_loops_back_to_start_on_eof():
    loop, cap = _loop_with(["f0", "f1"])
    # Drain the clip.
    assert loop.read_frame() == "f0"
    assert loop.read_frame() == "f1"
    # Next read hits EOF -> seek to frame 0 -> returns first frame again.
    assert loop.read_frame() == "f0"
    assert loop.loops == 1
    assert (CAP_PROP_POS_FRAMES, 0) in cap.set_calls
    # Playback continues seamlessly.
    assert loop.read_frame() == "f1"
    assert loop.read_frame() == "f0"
    assert loop.loops == 2


def test_loops_continuously_over_many_reads():
    frames = ["x", "y", "z"]
    loop, _ = _loop_with(frames)
    # Read well past the clip length; every frame must match the cyclic pattern.
    for i in range(10):
        assert loop.read_frame() == frames[i % len(frames)]
    # 10 reads over a 3-frame clip => wrapped 3 times (after frames 3,6,9).
    assert loop.loops == 3


def test_single_frame_clip_repeats():
    loop, _ = _loop_with(["only"])
    for _ in range(5):
        assert loop.read_frame() == "only"


def test_seek_uses_frame_zero_property():
    loop, cap = _loop_with(["a"])
    loop.read_frame()  # consume the only frame
    loop.read_frame()  # EOF -> rewind -> returns "a"
    assert cap.set_calls[0] == (CAP_PROP_POS_FRAMES, 0)


def test_missing_clip_surfaces_error_without_raising():
    # No capture injected and the path does not exist -> error state, not open.
    loop = VideoLoop(2, "clips/does_not_exist_lane_2.mp4")
    assert loop.opened is False
    assert loop.is_open() is False
    assert loop.read_frame() is None
    assert loop.error is not None
    assert loop.error.lane_id == 2
    assert loop.error.code == "CLIP_OPEN_FAILED"
    assert "lane_2" in loop.error.message


def test_unopened_injected_capture_surfaces_error():
    cap = StubCapture(["a"], opened=False)
    loop = VideoLoop(1, "clips/lane_1.mp4", capture=cap)
    assert loop.opened is False
    assert loop.error is not None
    assert loop.error.lane_id == 1
    assert loop.read_frame() is None


def test_capture_factory_used_when_no_capture_injected():
    cap = StubCapture(["frame"])
    seen_paths: list[str] = []

    def factory(path):
        seen_paths.append(path)
        return cap

    # Use a real existing file path so the is_file() guard passes; the factory
    # then supplies the synthetic capture.
    loop = VideoLoop(3, __file__, capture_factory=factory)
    assert seen_paths == [__file__]
    assert loop.lane_id == 3
    assert loop.opened is True
    assert loop.read_frame() == "frame"


def test_factory_returning_none_records_error():
    def factory(_path):
        return None

    loop = VideoLoop(0, __file__, capture_factory=factory)
    assert loop.opened is False
    assert loop.error is not None
    assert loop.error.code == "CLIP_OPEN_FAILED"


def test_empty_clip_after_rewind_records_error():
    # A capture that never yields a frame: first read EOF, rewind, still EOF.
    loop, _ = _loop_with([])
    assert loop.read_frame() is None
    assert loop.error is not None
    assert loop.error.code == "CLIP_READ_FAILED"
    assert loop.opened is False


def test_release_releases_capture():
    loop, cap = _loop_with(["a"])
    loop.release()
    assert cap.released is True
    assert loop.opened is False


def test_context_manager_releases():
    cap = StubCapture(["a"])
    with VideoLoop(0, "clips/lane_0.mp4", capture=cap) as loop:
        assert loop.read_frame() == "a"
    assert cap.released is True
