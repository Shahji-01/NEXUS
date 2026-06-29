"""Tests for the per-lane detection pipeline (`app.pipeline`).

These exercise the pipeline with lightweight stand-ins — a stub `VideoLoop`
capture and a stub detector — so they require neither real mp4 clips, OpenCV,
nor the ultralytics ML stack (stdlib-only).

Requirements:
  - 2.1: per-lane detection results expose detected vehicles.
  - 2.5: an unprocessable frame / unopenable clip yields a lane-identifying error.
  - 8.2: detections payload returns the latest per-lane result for all lanes.
  - 11.4: a single lane error does not suppress the other lanes.
  - 1.6: when all clips fail to open the status is config_error.
"""

from __future__ import annotations

from typing import Any, Dict, List

from app.config import DetectorConfig
from app.health import STATUS_CONFIG_ERROR, STATUS_OK
from app.pipeline import DetectionPipeline
from app.video_loop import VideoLoop


class FakeFrame:
    """A frame stand-in exposing a numpy-like ``shape`` (h, w, c)."""

    shape = (480, 640, 3)


class StubCapture:
    """A minimal FrameCapture stub returning a fixed number of frames then EOF.

    Satisfies the `app.video_loop.FrameCapture` protocol so a `VideoLoop` can be
    built without OpenCV or a real file.
    """

    def __init__(self, frames: int = 100) -> None:
        self._remaining = frames

    def isOpened(self) -> bool:  # noqa: N802 - matches cv2 naming
        return True

    def read(self):
        if self._remaining <= 0:
            return False, None
        self._remaining -= 1
        return True, FakeFrame()

    def set(self, prop_id: int, value: float) -> bool:
        self._remaining = 100
        return True

    def release(self) -> None:
        pass


class StubDetector:
    """A detector stub returning a fixed detection list for any frame."""

    def __init__(self, detections: List[Dict[str, Any]]):
        self._detections = detections
        self.calls = 0

    def detect(self, frame: Any) -> List[Dict[str, Any]]:
        self.calls += 1
        return list(self._detections)


class ExplodingDetector:
    """A detector stub that raises — simulates an unavailable model (R2.5)."""

    def detect(self, frame: Any):
        raise RuntimeError("ultralytics is not installed")


def _open_loop(lane_id: int) -> VideoLoop:
    return VideoLoop(lane_id, f"lane_{lane_id}.mp4", capture=StubCapture())


def _sample_detections() -> List[Dict[str, Any]]:
    return [
        {"class_name": "car", "bbox": [10, 10, 40, 30], "confidence": 0.9},
        {"class_name": "car", "bbox": [100, 50, 40, 30], "confidence": 0.8},
        {"class_name": "bike", "bbox": [200, 80, 20, 20], "confidence": 0.7},
        {"class_name": "truck", "bbox": [300, 120, 80, 60], "confidence": 0.95},
    ]


def _all_lane_loops() -> Dict[int, VideoLoop]:
    return {i: _open_loop(i) for i in range(4)}


def test_process_lane_success_returns_full_contract():
    # Requirement 2.1 / 2.4: per-lane result with exact counts and all fields.
    detector = StubDetector(_sample_detections())
    pipeline = DetectionPipeline(detector=detector, video_loops=_all_lane_loops())

    result, error = pipeline.process_lane(0)

    assert error is None
    assert result is not None
    # Detection_Result contract fields are all present.
    for key in (
        "detector_lane",
        "lane_id",
        "direction",
        "vehicle_count",
        "cars",
        "bikes",
        "trucks",
        "buses",
        "density",
        "avg_speed",
        "congestion_level",
        "emergency",
        "frame_id",
        "produced_at",
        "error",
    ):
        assert key in result, f"missing field: {key}"

    assert result["lane_id"] == 0
    assert result["detector_lane"] == "cam_north"
    assert result["direction"] == "North"
    # vehicle_count == exact sum of classes (R2.4 / R6.3).
    assert result["vehicle_count"] == 4
    assert result["cars"] == 2
    assert result["bikes"] == 1
    assert result["trucks"] == 1
    assert result["buses"] == 0
    assert 0.0 <= result["density"] <= 100.0
    assert 0.0 <= result["avg_speed"] <= 200.0
    assert result["congestion_level"] in {"low", "medium", "high", "critical"}
    assert result["error"] is None


def test_process_lane_detection_failure_is_lane_error():
    # Requirement 2.5: a frame that cannot be processed (model unavailable)
    # yields a lane-identifying error rather than raising.
    pipeline = DetectionPipeline(detector=ExplodingDetector(), video_loops=_all_lane_loops())

    result, error = pipeline.process_lane(1)

    assert result is None
    assert error is not None
    assert error["code"] == "FRAME_PROCESS_FAILED"
    assert error["lane_id"] == 1


def test_process_lane_unopenable_clip_is_error():
    # Requirement 1.4: an unopenable / missing clip surfaces a lane error.
    loops = _all_lane_loops()
    # Lane 2 has no clip and no injected capture -> open error.
    loops[2] = VideoLoop(2, "missing_lane_2.mp4")
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=loops)

    result, error = pipeline.process_lane(2)
    assert result is None
    assert error is not None
    assert error["code"] == "CLIP_OPEN_FAILED"
    assert error["lane_id"] == 2


def test_detections_payload_all_lanes_ok():
    # Requirement 8.2 / 2.1: latest per-lane results for all lanes, status ok.
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=_all_lane_loops())
    payload = pipeline.detections_payload()

    assert payload["service_status"] == STATUS_OK
    assert set(payload["lanes"].keys()) == {"0", "1", "2", "3"}
    for lane_id in ("0", "1", "2", "3"):
        entry = payload["lanes"][lane_id]
        assert entry["error"] is None
        assert entry["result"] is not None
        assert entry["result"]["vehicle_count"] == 4


def test_detections_payload_one_bad_lane_others_ok():
    # Requirement 11.4 / 1.5: one bad lane errors while the others succeed.
    loops = _all_lane_loops()
    loops[2] = VideoLoop(2, "missing_lane_2.mp4")
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=loops)
    payload = pipeline.detections_payload()

    assert payload["service_status"] == STATUS_OK
    assert payload["lanes"]["2"]["result"] is None
    assert payload["lanes"]["2"]["error"]["code"] == "CLIP_OPEN_FAILED"
    assert payload["lanes"]["0"]["result"]["vehicle_count"] == 4
    assert payload["lanes"]["1"]["error"] is None
    assert payload["lanes"]["3"]["error"] is None


def test_detections_payload_all_clips_fail_is_config_error():
    # Requirement 1.6: all clips fail to open -> system-wide config_error.
    loops = {i: VideoLoop(i, f"missing_lane_{i}.mp4") for i in range(4)}
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=loops)
    payload = pipeline.detections_payload()

    assert payload["service_status"] == STATUS_CONFIG_ERROR
    assert all(payload["lanes"][str(i)]["result"] is None for i in range(4))


def test_lane_payload_unknown_lane_is_none():
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=_all_lane_loops())
    assert pipeline.lane_payload(99) is None


def test_lane_payload_returns_entry_for_known_lane():
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=_all_lane_loops())
    entry = pipeline.lane_payload(3)
    assert entry is not None
    assert entry["lane_id"] == 3
    assert entry["result"]["detector_lane"] == "cam_west"
    assert entry["error"] is None


def test_health_all_clips_missing_is_config_error():
    # Requirement 1.6 / 11.1: health reports config_error when all clips fail.
    loops = {i: VideoLoop(i, f"missing_lane_{i}.mp4") for i in range(4)}
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=loops)
    health = pipeline.health()

    assert health["status"] == STATUS_CONFIG_ERROR
    assert health["failed_lanes"] == [0, 1, 2, 3]
    assert set(health["lanes"].keys()) == {"0", "1", "2", "3"}
    for i in range(4):
        assert health["lanes"][str(i)]["opened"] is False
        assert health["lanes"][str(i)]["error"] is not None


def test_health_all_clips_ok_is_ok():
    pipeline = DetectionPipeline(detector=StubDetector(_sample_detections()), video_loops=_all_lane_loops())
    health = pipeline.health()
    assert health["status"] == STATUS_OK
    assert health["failed_lanes"] == []
    assert all(health["lanes"][str(i)]["opened"] for i in range(4))


def test_speed_estimator_state_is_reused_across_frames():
    # The pipeline holds one LaneSpeedEstimator per lane, so a second processing
    # pass can produce a non-zero speed once a vehicle is tracked across frames.
    detector = StubDetector(_sample_detections())
    pipeline = DetectionPipeline(detector=detector, video_loops=_all_lane_loops())

    first, _ = pipeline.process_lane(0)
    second, _ = pipeline.process_lane(0)

    # Detector was called once per pass against the same lane state.
    assert detector.calls == 2
    assert first is not None and second is not None
    # Same detections each frame -> zero displacement -> avg_speed stays 0,
    # but the call must succeed and stay within bounds.
    assert 0.0 <= second["avg_speed"] <= 200.0


def test_custom_config_lane_mapping_reverse():
    # detector_lane is derived by inverting the configured Lane_Mapping (R10.5).
    cfg = DetectorConfig(lane_mapping={"cam_a": 0, "cam_b": 1})
    loops = {0: _open_loop(0), 1: _open_loop(1)}
    pipeline = DetectionPipeline(config=cfg, detector=StubDetector(_sample_detections()), video_loops=loops)
    assert pipeline.lane_ids == [0, 1]
    result, _ = pipeline.process_lane(0)
    assert result["detector_lane"] == "cam_a"
