"""Tests for per-lane and system-wide error handling (`app.health`).

These exercise the error-handling layer with lightweight stand-ins (a tiny
VideoLoop-like stub, `CaptureError`, and plain dicts), so they require neither
real mp4 clips nor OpenCV (stdlib-only).

Requirements:
  - 1.4: a missing/unopenable clip reports a source error identifying the Lane ID.
  - 1.5: when a Lane's clip is unavailable, the others keep producing output.
  - 1.6: if all four clips fail to open, report a system-wide configuration error.
  - 2.5: if a frame cannot be processed, return an error identifying the Lane ID.
  - 11.4: if the service returns an error for a single Lane, the others continue.
"""

from __future__ import annotations

from app.health import (
    STATUS_CONFIG_ERROR,
    STATUS_OK,
    build_detections_payload,
    build_lane_result_entry,
    build_lane_results,
    compute_health,
    failed_lane_ids,
    frame_error,
    lane_error_map,
    normalize_lane_error,
    service_status,
)
from app.video_loop import CaptureError


class StubLoop:
    """A minimal VideoLoop-like stand-in exposing `opened`/`error`/`lane_id`."""

    def __init__(self, lane_id: int, opened: bool, error: CaptureError | None = None):
        self.lane_id = lane_id
        self._opened = opened
        self._error = error

    @property
    def opened(self) -> bool:
        return self._opened

    def is_open(self) -> bool:
        return self._opened

    @property
    def error(self) -> CaptureError | None:
        return self._error


def _ok_loop(lane_id: int) -> StubLoop:
    return StubLoop(lane_id, opened=True)


def _bad_loop(lane_id: int) -> StubLoop:
    return StubLoop(
        lane_id,
        opened=False,
        error=CaptureError(
            code="CLIP_OPEN_FAILED",
            message=f"lane_{lane_id} clip not found",
            lane_id=lane_id,
        ),
    )


# --- normalize_lane_error -------------------------------------------------


def test_normalize_none_is_healthy():
    assert normalize_lane_error(None) is None


def test_normalize_open_loop_is_healthy():
    assert normalize_lane_error(_ok_loop(0), 0) is None


def test_normalize_closed_loop_returns_its_error():
    err = normalize_lane_error(_bad_loop(2), 2)
    assert err is not None
    assert err["code"] == "CLIP_OPEN_FAILED"
    assert "lane_2" in err["message"]
    assert err["lane_id"] == 2


def test_normalize_closed_loop_without_error_synthesises_one():
    loop = StubLoop(3, opened=False, error=None)
    err = normalize_lane_error(loop, 3)
    assert err is not None
    assert err["code"] == "CLIP_OPEN_FAILED"
    assert "lane_3" in err["message"]


def test_normalize_capture_error_object():
    err = normalize_lane_error(CaptureError("X", "boom", 1), 1)
    assert err == {"code": "X", "message": "boom", "lane_id": 1}


def test_normalize_error_mapping():
    err = normalize_lane_error({"code": "FRAME_PROCESS_FAILED", "message": "bad frame"}, 0)
    assert err["code"] == "FRAME_PROCESS_FAILED"
    assert err["message"] == "bad frame"


# --- service status & health ---------------------------------------------


def test_all_lanes_ok_status_is_ok():
    states = {i: _ok_loop(i) for i in range(4)}
    assert service_status(states) == STATUS_OK
    health = compute_health(states)
    assert health["service_status"] == STATUS_OK
    assert health["failed_lanes"] == []
    assert all(v is None for v in health["lane_errors"].values())


def test_one_lane_fails_others_ok(  ):
    # Requirement 1.5 / 11.4: one bad lane does not fail the batch.
    states = {0: _ok_loop(0), 1: _ok_loop(1), 2: _bad_loop(2), 3: _ok_loop(3)}
    assert service_status(states) == STATUS_OK
    health = compute_health(states)
    assert health["service_status"] == STATUS_OK
    assert health["failed_lanes"] == [2]
    assert health["lane_errors"][2] is not None
    assert health["lane_errors"][0] is None
    assert health["lane_errors"][1] is None
    assert health["lane_errors"][3] is None


def test_all_lanes_fail_is_config_error():
    # Requirement 1.6: all four clips fail to open -> system-wide config error.
    states = {i: _bad_loop(i) for i in range(4)}
    assert service_status(states) == STATUS_CONFIG_ERROR
    health = compute_health(states)
    assert health["service_status"] == STATUS_CONFIG_ERROR
    assert health["failed_lanes"] == [0, 1, 2, 3]


def test_empty_states_is_ok():
    assert service_status({}) == STATUS_OK
    assert compute_health({})["service_status"] == STATUS_OK


def test_failed_lane_ids_helper():
    states = {0: _ok_loop(0), 1: _bad_loop(1), 2: _bad_loop(2), 3: _ok_loop(3)}
    assert failed_lane_ids(states) == [1, 2]


def test_lane_error_map_covers_all_lanes():
    states = {0: _ok_loop(0), 1: _bad_loop(1)}
    errors = lane_error_map(states)
    assert set(errors.keys()) == {0, 1}
    assert errors[0] is None
    assert errors[1] is not None


# --- per-lane result entries ---------------------------------------------


def test_build_entry_for_healthy_lane_carries_result():
    result = {"vehicle_count": 5, "cars": 5}
    entry = build_lane_result_entry(0, result=result)
    assert entry == {"lane_id": 0, "result": result, "error": None}


def test_build_entry_for_errored_lane_has_null_result():
    entry = build_lane_result_entry(2, error=CaptureError("CLIP_OPEN_FAILED", "no clip", 2))
    assert entry["lane_id"] == 2
    assert entry["result"] is None
    assert entry["error"]["code"] == "CLIP_OPEN_FAILED"
    assert entry["error"]["lane_id"] == 2


def test_build_lane_results_one_bad_others_ok():
    # Requirement 1.5 / 11.4: a single bad lane never suppresses the others.
    results = {0: {"vehicle_count": 3}, 1: {"vehicle_count": 7}, 3: {"vehicle_count": 0}}
    errors = {2: CaptureError("CLIP_OPEN_FAILED", "lane_2 clip not found", 2)}
    entries = build_lane_results(results=results, errors=errors, lane_ids=[0, 1, 2, 3])

    assert set(entries.keys()) == {0, 1, 2, 3}
    assert entries[0]["result"] == {"vehicle_count": 3}
    assert entries[0]["error"] is None
    assert entries[2]["result"] is None
    assert entries[2]["error"]["code"] == "CLIP_OPEN_FAILED"
    assert entries[1]["result"] == {"vehicle_count": 7}


def test_build_lane_results_error_takes_precedence_over_result():
    # If a lane has both a stale result and an error, the error wins.
    entries = build_lane_results(
        results={0: {"vehicle_count": 9}},
        errors={0: frame_error(0, "decode failed")},
    )
    assert entries[0]["result"] is None
    assert entries[0]["error"]["code"] == "FRAME_PROCESS_FAILED"
    assert entries[0]["error"]["lane_id"] == 0


def test_frame_error_identifies_lane():
    # Requirement 2.5: an unprocessable frame yields a lane-identifying error.
    err = frame_error(1, "could not decode frame")
    assert err["code"] == "FRAME_PROCESS_FAILED"
    assert err["lane_id"] == 1
    assert "decode" in err["message"]


# --- detections payload ---------------------------------------------------


def test_detections_payload_ok_with_one_error_lane():
    results = {0: {"vehicle_count": 1}, 1: {"vehicle_count": 2}, 3: {"vehicle_count": 3}}
    states = {0: _ok_loop(0), 1: _ok_loop(1), 2: _bad_loop(2), 3: _ok_loop(3)}
    errors = {2: states[2].error}
    payload = build_detections_payload(
        results=results, errors=errors, lane_states=states, lane_ids=[0, 1, 2, 3]
    )
    assert payload["service_status"] == STATUS_OK
    assert payload["lanes"]["2"]["result"] is None
    assert payload["lanes"]["2"]["error"]["code"] == "CLIP_OPEN_FAILED"
    assert payload["lanes"]["0"]["result"] == {"vehicle_count": 1}


def test_detections_payload_config_error_when_all_fail():
    states = {i: _bad_loop(i) for i in range(4)}
    errors = {i: states[i].error for i in range(4)}
    payload = build_detections_payload(
        errors=errors, lane_states=states, lane_ids=[0, 1, 2, 3]
    )
    assert payload["service_status"] == STATUS_CONFIG_ERROR
    assert all(payload["lanes"][str(i)]["result"] is None for i in range(4))


def test_detections_payload_status_from_errors_only():
    # Without lane_states, status is derived from the error entries alone.
    ok_payload = build_detections_payload(
        results={0: {"vehicle_count": 1}}, errors={1: frame_error(1, "x")}, lane_ids=[0, 1]
    )
    assert ok_payload["service_status"] == STATUS_OK

    all_bad = build_detections_payload(
        errors={0: frame_error(0, "x"), 1: frame_error(1, "y")}, lane_ids=[0, 1]
    )
    assert all_bad["service_status"] == STATUS_CONFIG_ERROR
