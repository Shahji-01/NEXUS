"""Tests for the overlay rendering/encoding module and the overlay endpoints.

Two layers are covered:

  * The reusable :mod:`app.overlay` functions are exercised directly (stdlib
    only). The draw/encode/render functions must degrade gracefully — returning
    a valid placeholder JPEG — when OpenCV is unavailable or a frame is missing,
    and must handle empty detections (Requirements 9.1, 9.2; placeholder per
    9.3).
  * The FastAPI overlay endpoints (`GET /lanes/{laneId}/frame` and
    `GET /lanes/{laneId}/mjpeg`) are exercised with the ``TestClient`` against a
    stubbed pipeline, asserting the JPEG content-type, the unknown-lane 404, and
    that an MJPEG stream is produced (Requirements 9.1, 9.2, 9.4).

The endpoint tests are guarded with ``importorskip`` so the suite stays runnable
when FastAPI / its test client are not installed.
"""

from __future__ import annotations

from app.overlay import (
    MJPEG_BOUNDARY,
    PLACEHOLDER_JPEG,
    draw_detections,
    encode_jpeg,
    mjpeg_chunk,
    placeholder_jpeg,
    render_annotated_jpeg,
)

# --- overlay module: pure helpers ---------------------------------------

_SAMPLE_DETECTIONS = [
    {"class_name": "car", "bbox": [10, 10, 40, 30], "confidence": 0.9},
    {"class_name": "bike", "bbox": [200, 80, 20, 20], "confidence": 0.7},
]


def _is_jpeg(data: bytes) -> bool:
    """A well-formed JPEG starts with the SOI marker and ends with EOI."""
    return (
        isinstance(data, (bytes, bytearray))
        and len(data) >= 4
        and data[:2] == b"\xff\xd8"
        and data[-2:] == b"\xff\xd9"
    )


def test_placeholder_jpeg_is_valid_jpeg_bytes():
    data = placeholder_jpeg()
    assert data is PLACEHOLDER_JPEG
    assert _is_jpeg(data)


def test_render_with_no_frame_returns_placeholder():
    # No frame available -> graceful degradation to the placeholder JPEG.
    out = render_annotated_jpeg(None, _SAMPLE_DETECTIONS)
    assert out == PLACEHOLDER_JPEG
    assert _is_jpeg(out)


def test_render_with_empty_detections_returns_jpeg():
    # Empty detections must still yield a valid JPEG (placeholder when no frame).
    out = render_annotated_jpeg(None, [])
    assert _is_jpeg(out)


def test_encode_jpeg_none_frame_returns_none():
    assert encode_jpeg(None) is None


def test_draw_detections_without_cv2_returns_frame_unchanged():
    # When cv2 is unavailable, draw_detections returns the frame as-is (the
    # caller then falls back to a placeholder via render_annotated_jpeg).
    import app.overlay as overlay

    if overlay.cv2_available():
        # cv2 is present: drawing should not raise and should return an array.
        import numpy as np  # type: ignore

        frame = np.zeros((20, 20, 3), dtype="uint8")
        annotated = draw_detections(frame, _SAMPLE_DETECTIONS)
        assert annotated is not None
        encoded = encode_jpeg(annotated)
        assert encoded is not None and _is_jpeg(encoded)
    else:
        sentinel = object()
        assert draw_detections(sentinel, _SAMPLE_DETECTIONS) is sentinel


def test_render_uses_cv2_when_available():
    import app.overlay as overlay

    if not overlay.cv2_available():
        # Without cv2 every render degrades to the placeholder regardless of frame.
        assert render_annotated_jpeg(object(), _SAMPLE_DETECTIONS) == PLACEHOLDER_JPEG
        return

    import numpy as np  # type: ignore

    frame = np.zeros((32, 32, 3), dtype="uint8")
    out = render_annotated_jpeg(frame, _SAMPLE_DETECTIONS)
    assert _is_jpeg(out)
    # A real encoded frame differs from the 1x1 placeholder.
    assert out != PLACEHOLDER_JPEG


def test_mjpeg_chunk_structure():
    chunk = mjpeg_chunk(PLACEHOLDER_JPEG, MJPEG_BOUNDARY)
    assert chunk.startswith(f"--{MJPEG_BOUNDARY}\r\n".encode("ascii"))
    assert b"Content-Type: image/jpeg\r\n" in chunk
    assert f"Content-Length: {len(PLACEHOLDER_JPEG)}".encode("ascii") in chunk
    assert chunk.endswith(PLACEHOLDER_JPEG + b"\r\n")


# --- FastAPI overlay endpoints ------------------------------------------


def _stub_pipeline():
    from app.pipeline import DetectionPipeline
    from app.video_loop import VideoLoop

    from tests.test_pipeline import StubCapture, StubDetector, _sample_detections

    loops = {i: VideoLoop(i, f"lane_{i}.mp4", capture=StubCapture()) for i in range(4)}
    return DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=loops)


def test_frame_endpoint_returns_jpeg():
    import pytest

    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")

    from fastapi.testclient import TestClient

    from app.main import app
    from app.pipeline import set_pipeline

    set_pipeline(_stub_pipeline())
    try:
        client = TestClient(app)
        resp = client.get("/lanes/0/frame")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        # Placeholder is acceptable when cv2 is absent; either way it's JPEG bytes.
        assert _is_jpeg(resp.content)
    finally:
        set_pipeline(None)


def test_frame_endpoint_unknown_lane_is_404():
    import pytest

    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")

    from fastapi.testclient import TestClient

    from app.main import app
    from app.pipeline import set_pipeline

    set_pipeline(_stub_pipeline())
    try:
        client = TestClient(app)
        resp = client.get("/lanes/99/frame")
        assert resp.status_code == 404
    finally:
        set_pipeline(None)


def test_mjpeg_endpoint_streams_multipart():
    import pytest

    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")

    from fastapi.testclient import TestClient

    from app.main import app
    from app.pipeline import set_pipeline

    set_pipeline(_stub_pipeline())
    try:
        client = TestClient(app)
        # Bound the stream with ?frames= so the test doesn't stream forever.
        resp = client.get("/lanes/0/mjpeg?frames=2")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("multipart/x-mixed-replace")
        assert MJPEG_BOUNDARY in resp.headers["content-type"]
        body = resp.content
        assert body.count(f"--{MJPEG_BOUNDARY}".encode("ascii")) == 2
        assert b"Content-Type: image/jpeg" in body
    finally:
        set_pipeline(None)


def test_mjpeg_endpoint_unknown_lane_is_404():
    import pytest

    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")

    from fastapi.testclient import TestClient

    from app.main import app
    from app.pipeline import set_pipeline

    set_pipeline(_stub_pipeline())
    try:
        client = TestClient(app)
        resp = client.get("/lanes/99/mjpeg?frames=1")
        assert resp.status_code == 404
    finally:
        set_pipeline(None)
