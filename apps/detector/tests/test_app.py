"""Tests for the FastAPI app skeleton.

Skipped automatically when FastAPI / its test client are not installed, so the
suite stays runnable in a bare environment during scaffolding.
"""

from __future__ import annotations

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import DetectorConfig  # noqa: E402
from app.main import app  # noqa: E402
from app.health import STATUS_CONFIG_ERROR, STATUS_OK  # noqa: E402
from app.pipeline import DetectionPipeline, set_pipeline  # noqa: E402
from app.video_loop import VideoLoop  # noqa: E402

from tests.test_pipeline import (  # noqa: E402
    StubCapture,
    StubDetector,
    _sample_detections,
)


client = TestClient(app)


def _stub_pipeline_all_ok() -> DetectionPipeline:
    loops = {i: VideoLoop(i, f"lane_{i}.mp4", capture=StubCapture()) for i in range(4)}
    return DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=loops)


def _pipeline_missing_clips() -> DetectionPipeline:
    # Point the pipeline at a clips directory that cannot exist, so every lane's
    # clip fails to open deterministically — independent of whether real demo
    # clips happen to be present in the environment.
    return DetectionPipeline(config=DetectorConfig(clips_dir="__no_such_clips_dir__"))


def test_get_config_returns_lane_mapping():
    resp = client.get("/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["lane_mapping"] == {
        "cam_north": 0,
        "cam_south": 1,
        "cam_east": 2,
        "cam_west": 3,
    }
    assert body["port"] == 8099
    assert "emergency_confidence_min" in body["thresholds"]


def test_health_with_missing_clips_is_config_error():
    # A pipeline pointed at a missing clips dir reports config_error while still
    # listing per-lane health (R1.6, R11.1).
    set_pipeline(_pipeline_missing_clips())
    try:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == STATUS_CONFIG_ERROR
        assert body["service_status"] == STATUS_CONFIG_ERROR
        assert set(body["lanes"].keys()) == {"0", "1", "2", "3"}
        for lane in body["lanes"].values():
            assert lane["opened"] is False
            assert lane["error"] is not None
    finally:
        set_pipeline(None)


def test_detections_with_missing_clips_yields_per_lane_errors():
    # Requirement 2.5 / 11.4 / 1.6: missing clips produce per-lane errors and a
    # config_error overall status, without raising.
    set_pipeline(_pipeline_missing_clips())
    try:
        resp = client.get("/detections")
        assert resp.status_code == 200
        body = resp.json()
        assert body["service_status"] == STATUS_CONFIG_ERROR
        assert set(body["lanes"].keys()) == {"0", "1", "2", "3"}
        for entry in body["lanes"].values():
            assert entry["result"] is None
            assert entry["error"] is not None
            assert entry["error"]["code"] == "CLIP_OPEN_FAILED"
    finally:
        set_pipeline(None)


def test_detections_all_lanes_ok_through_endpoint():
    # Requirement 2.1 / 8.2: with a healthy (stubbed) pipeline the endpoint
    # returns the per-lane Detection_Result contract for all four lanes.
    set_pipeline(_stub_pipeline_all_ok())
    try:
        resp = client.get("/detections")
        assert resp.status_code == 200
        body = resp.json()
        assert body["service_status"] == STATUS_OK
        assert set(body["lanes"].keys()) == {"0", "1", "2", "3"}
        entry = body["lanes"]["0"]
        assert entry["error"] is None
        result = entry["result"]
        assert result["lane_id"] == 0
        assert result["detector_lane"] == "cam_north"
        assert result["vehicle_count"] == result["cars"] + result["bikes"] + result["trucks"] + result["buses"]
        assert 0.0 <= result["density"] <= 100.0
        assert 0.0 <= result["avg_speed"] <= 200.0
        assert result["congestion_level"] in {"low", "medium", "high", "critical"}
    finally:
        set_pipeline(None)


def test_single_lane_endpoint_returns_entry():
    set_pipeline(_stub_pipeline_all_ok())
    try:
        resp = client.get("/detections/2")
        assert resp.status_code == 200
        entry = resp.json()
        assert entry["lane_id"] == 2
        assert entry["error"] is None
        assert entry["result"]["detector_lane"] == "cam_east"
    finally:
        set_pipeline(None)


def test_single_lane_endpoint_unknown_lane_is_404():
    set_pipeline(_stub_pipeline_all_ok())
    try:
        resp = client.get("/detections/99")
        assert resp.status_code == 404
    finally:
        set_pipeline(None)


def test_single_lane_endpoint_missing_clip_is_per_lane_error():
    # Requirement 2.5 / 11.4: an unopenable clip yields result:null + error,
    # not a 5xx.
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops={
        0: VideoLoop(0, "lane_0.mp4", capture=StubCapture()),
        1: VideoLoop(1, "missing_lane_1.mp4"),
        2: VideoLoop(2, "lane_2.mp4", capture=StubCapture()),
        3: VideoLoop(3, "lane_3.mp4", capture=StubCapture()),
    })
    set_pipeline(pipeline)
    try:
        resp = client.get("/detections/1")
        assert resp.status_code == 200
        entry = resp.json()
        assert entry["lane_id"] == 1
        assert entry["result"] is None
        assert entry["error"]["code"] == "CLIP_OPEN_FAILED"
        assert entry["error"]["lane_id"] == 1
    finally:
        set_pipeline(None)
