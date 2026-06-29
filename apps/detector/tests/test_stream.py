"""Tests for the WS ``/stream`` push channel (`app.stream` + the endpoint).

Two layers are covered:

  * The reusable :func:`app.stream.iter_detection_frames` async generator is
    exercised directly with a stubbed pipeline and an injected (instant) sleeper,
    so the message stream is validated without a real socket, clips, or model.
  * The FastAPI ``WS /stream`` endpoint is exercised with the ``TestClient``
    websocket connection against a stubbed pipeline (via ``set_pipeline``),
    asserting the ``detection_frame`` messages arrive with the expected shape.

The websocket-endpoint tests are guarded with ``importorskip`` so the suite stays
runnable when FastAPI / its test client are not installed.

Requirements:
  - 2.1: push per-lane detection results as frames are processed.
  - 8.1: the detector pushes the latest per-lane result as each clip frame is
    processed.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

from app.stream import (
    MESSAGE_TYPE,
    build_detection_frame,
    default_frame_interval,
    iter_detection_frames,
    process_lane_frame,
)


class FakeLanePipeline:
    """A stand-in pipeline exposing ``lane_ids`` and ``process_lane``.

    Returns a canned successful result for healthy lanes and a per-lane error for
    lanes listed in ``error_lanes`` — no real clips/model involved.
    """

    def __init__(self, lane_ids: List[int], error_lanes: List[int] | None = None) -> None:
        self._lane_ids = list(lane_ids)
        self._error_lanes = set(error_lanes or [])
        self.calls: List[int] = []

    @property
    def lane_ids(self) -> List[int]:
        return list(self._lane_ids)

    def process_lane(self, lane_id: int):
        self.calls.append(lane_id)
        if lane_id in self._error_lanes:
            return None, {"lane_id": lane_id, "code": "CLIP_OPEN_FAILED", "message": "boom"}
        result = {
            "lane_id": lane_id,
            "detector_lane": f"cam_{lane_id}",
            "vehicle_count": 3,
            "cars": 2,
            "bikes": 1,
            "trucks": 0,
            "buses": 0,
            "density": 12.5,
            "avg_speed": 30.0,
            "congestion_level": "low",
            "emergency": None,
            "frame_id": 1,
            "produced_at": "2026-05-10T07:28:00.120Z",
            "error": None,
        }
        return result, None


class ExplodingPipeline:
    """A pipeline whose ``process_lane`` raises — must not crash the stream."""

    @property
    def lane_ids(self) -> List[int]:
        return [0]

    def process_lane(self, lane_id: int):
        raise RuntimeError("model unavailable")


async def _instant_sleep(_seconds: float) -> None:
    """A no-delay sleeper so paced loops run instantly in tests."""
    return None


async def _collect(pipeline, **kwargs) -> List[Dict[str, Any]]:
    return [frame async for frame in iter_detection_frames(pipeline, sleeper=_instant_sleep, **kwargs)]


# --- build_detection_frame / process_lane_frame --------------------------


def test_build_detection_frame_shape():
    frame = build_detection_frame(2, {"lane_id": 2}, None)
    assert frame == {"type": MESSAGE_TYPE, "lane_id": 2, "result": {"lane_id": 2}, "error": None}


def test_process_lane_frame_success():
    pipeline = FakeLanePipeline([0])
    frame = process_lane_frame(pipeline, 0)
    assert frame["type"] == "detection_frame"
    assert frame["lane_id"] == 0
    assert frame["error"] is None
    assert frame["result"]["vehicle_count"] == 3


def test_process_lane_frame_guards_unexpected_exception():
    # A raising pipeline must yield a per-lane error frame, not propagate (R11.4).
    frame = process_lane_frame(ExplodingPipeline(), 0)
    assert frame["result"] is None
    assert frame["error"]["code"] == "STREAM_PROCESS_FAILED"
    assert frame["error"]["lane_id"] == 0


# --- iter_detection_frames ----------------------------------------------


def test_iter_yields_one_frame_per_lane_per_sweep():
    # Requirement 2.1 / 8.1: one DetectionFrame per lane as frames are processed.
    pipeline = FakeLanePipeline([0, 1, 2, 3])
    frames = asyncio.run(_collect(pipeline, iterations=1, frame_interval=0))

    assert len(frames) == 4
    assert [f["lane_id"] for f in frames] == [0, 1, 2, 3]
    for f in frames:
        assert f["type"] == "detection_frame"
        assert set(f.keys()) == {"type", "lane_id", "result", "error"}
        assert f["error"] is None
        assert f["result"]["lane_id"] == f["lane_id"]


def test_iter_multiple_sweeps_repeats_lanes():
    pipeline = FakeLanePipeline([0, 1])
    frames = asyncio.run(_collect(pipeline, iterations=3, frame_interval=0))
    assert [f["lane_id"] for f in frames] == [0, 1, 0, 1, 0, 1]


def test_iter_emits_error_frames_without_stopping():
    # A bad lane yields an error frame; healthy lanes still produce results (R11.4).
    pipeline = FakeLanePipeline([0, 1, 2], error_lanes=[1])
    frames = asyncio.run(_collect(pipeline, iterations=1, frame_interval=0))

    by_lane = {f["lane_id"]: f for f in frames}
    assert by_lane[1]["result"] is None
    assert by_lane[1]["error"]["code"] == "CLIP_OPEN_FAILED"
    assert by_lane[0]["error"] is None
    assert by_lane[2]["error"] is None


def test_iter_uses_pipeline_lane_ids_by_default():
    pipeline = FakeLanePipeline([5, 6])
    frames = asyncio.run(_collect(pipeline, iterations=1, frame_interval=0))
    assert [f["lane_id"] for f in frames] == [5, 6]


def test_iter_paces_with_injected_sleeper():
    # The loop awaits the sleeper between messages so it never spins hot.
    pipeline = FakeLanePipeline([0, 1])
    sleeps: List[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async def run() -> List[Dict[str, Any]]:
        return [
            frame
            async for frame in iter_detection_frames(
                pipeline, iterations=1, frame_interval=0.05, sleeper=record_sleep
            )
        ]

    frames = asyncio.run(run())
    assert len(frames) == 2
    # One pacing sleep per emitted message.
    assert sleeps == [0.05, 0.05]


def test_default_frame_interval_is_sane_and_bounded():
    interval = default_frame_interval()
    # Derived from config FPS but capped to a sensible overall cadence.
    assert 1.0 / 20.0 <= interval <= 1.0


# --- WS endpoint via TestClient -----------------------------------------


def test_websocket_stream_pushes_detection_frames():
    import pytest

    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")

    from fastapi.testclient import TestClient

    from app.main import app
    from app.pipeline import set_pipeline

    set_pipeline(FakeLanePipeline([0, 1, 2, 3]))
    try:
        client = TestClient(app)
        with client.websocket_connect("/stream") as ws:
            received = [ws.receive_json() for _ in range(4)]

        assert [m["lane_id"] for m in received] == [0, 1, 2, 3]
        for m in received:
            assert m["type"] == "detection_frame"
            assert set(m.keys()) == {"type", "lane_id", "result", "error"}
            assert m["error"] is None
            assert m["result"]["lane_id"] == m["lane_id"]
            assert m["result"]["vehicle_count"] == (
                m["result"]["cars"]
                + m["result"]["bikes"]
                + m["result"]["trucks"]
                + m["result"]["buses"]
            )
    finally:
        set_pipeline(None)


def test_websocket_stream_emits_error_frame_for_bad_lane():
    import pytest

    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")

    from fastapi.testclient import TestClient

    from app.main import app
    from app.pipeline import set_pipeline

    set_pipeline(FakeLanePipeline([0, 1], error_lanes=[1]))
    try:
        client = TestClient(app)
        with client.websocket_connect("/stream") as ws:
            received = [ws.receive_json() for _ in range(2)]

        by_lane = {m["lane_id"]: m for m in received}
        assert by_lane[0]["error"] is None
        assert by_lane[1]["result"] is None
        assert by_lane[1]["error"]["code"] == "CLIP_OPEN_FAILED"
    finally:
        set_pipeline(None)
