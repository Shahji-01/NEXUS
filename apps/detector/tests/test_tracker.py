"""Tests for cross-frame tracking and per-lane speed estimation (stdlib-only).

Exercises the pure-Python centroid tracker and the lane speed estimator with
synthetic detection sequences:
  - stable track-ID assignment and association within the distance gate (R3.1),
  - moving centroids across consecutive frames -> expected km/h (R3.1, R3.2),
  - a single isolated frame -> 0.0 (R3.3),
  - speed clamped to [0, max_speed_kmh] (R3.4).

These tests deliberately avoid OpenCV / numpy / the ML stack: the tracker is
pure geometry over ``[x, y, w, h]`` detection dicts, matching the dependency-light
pattern of ``app.config`` and ``app.density``.
"""

from __future__ import annotations

import math

from app.config import DetectorConfig
from app.tracker import (
    CentroidTracker,
    LaneSpeedEstimator,
    bbox_centroid,
    displacement_to_kmh,
    estimate_lane_speed,
)


# A deterministic config independent of process env vars, with round numbers so
# expected speeds are easy to verify: 1 px/frame == mpp*fps*3.6 km/h.
#   mpp=0.05, fps=25  ->  0.05 * 25 * 3.6 = 4.5 km/h per pixel of per-frame motion.
TEST_CONFIG = DetectorConfig(meters_per_pixel=0.05, fps=25.0, max_speed_kmh=200.0)
KMH_PER_PIXEL = 0.05 * 25.0 * 3.6  # == 4.5


def _det(x: float, y: float, w: float = 10.0, h: float = 10.0) -> dict:
    """Build a minimal detection dict with an [x, y, w, h] bbox."""
    return {"class_name": "car", "bbox": [x, y, w, h], "confidence": 0.9}


# --- bbox_centroid / displacement_to_kmh helpers --------------------------

def test_bbox_centroid_is_box_center():
    assert bbox_centroid([10, 0, 10, 10]) == (15.0, 5.0)
    assert bbox_centroid([0, 0, 0, 0]) == (0.0, 0.0)


def test_displacement_to_kmh_conversion():
    # 10 px/frame at mpp=0.05, fps=25 -> 10 * 4.5 = 45 km/h.
    assert displacement_to_kmh(10.0, 0.05, 25.0) == 45.0
    # Zero displacement -> zero speed.
    assert displacement_to_kmh(0.0, 0.05, 25.0) == 0.0


# --- CentroidTracker: stable IDs and association (R3.1) -------------------

def test_tracker_registers_new_detections_with_unique_ids():
    tracker = CentroidTracker()
    assignment = tracker.update([(0.0, 0.0), (100.0, 100.0)])
    assert len(assignment) == 2
    # Two distinct, stable ids.
    assert sorted(assignment.keys()) == [0, 1]


def test_tracker_keeps_stable_id_for_moving_centroid():
    tracker = CentroidTracker()
    first = tracker.update([(5.0, 5.0)])
    track_id = next(iter(first))
    # Move within the distance gate: same id must persist.
    second = tracker.update([(15.0, 5.0)])
    assert track_id in second
    assert second[track_id] == (15.0, 5.0)


def test_tracker_assigns_new_id_when_jump_exceeds_gate():
    tracker = CentroidTracker(max_match_distance=20.0)
    first = tracker.update([(0.0, 0.0)])
    old_id = next(iter(first))
    # Jump far beyond the gate -> the old track is not matched; a new id appears.
    second = tracker.update([(500.0, 500.0)])
    assert old_id not in second
    assert next(iter(second)) != old_id


def test_tracker_ages_out_disappeared_tracks():
    tracker = CentroidTracker(max_disappeared=2)
    first = tracker.update([(0.0, 0.0)])
    old_id = next(iter(first))
    # Three empty frames exceed max_disappeared=2, so the track is dropped and
    # cannot be re-matched even at the same location.
    tracker.update([])
    tracker.update([])
    tracker.update([])
    reappeared = tracker.update([(0.0, 0.0)])
    assert old_id not in reappeared


def test_tracker_greedy_matches_nearest_pairs():
    tracker = CentroidTracker()
    first = tracker.update([(0.0, 0.0), (100.0, 0.0)])
    id_a = first[next(k for k, v in first.items() if v == (0.0, 0.0))]
    # Both move slightly; nearest-neighbour association keeps each id with its
    # closest successor rather than swapping them.
    second = tracker.update([(105.0, 0.0), (5.0, 0.0)])
    left_id = next(k for k, v in first.items() if v == (0.0, 0.0))
    right_id = next(k for k, v in first.items() if v == (100.0, 0.0))
    assert second[left_id] == (5.0, 0.0)
    assert second[right_id] == (105.0, 0.0)


# --- LaneSpeedEstimator: speed estimation (R3.2, R3.3, R3.4) --------------

def test_single_frame_reports_zero_speed():
    # One isolated frame: nothing tracked across two frames yet -> 0.0 (R3.3).
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    assert estimator.update([_det(0, 0)]) == 0.0


def test_empty_frame_reports_zero_speed():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    assert estimator.update([]) == 0.0


def test_moving_vehicle_reports_expected_speed():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    # Frame 1 establishes the track (returns 0.0, no prior frame).
    assert estimator.update([_det(0, 0)]) == 0.0
    # Frame 2: centroid moves 10 px (from (5,5) to (15,5)) -> 10 * 4.5 = 45 km/h.
    speed = estimator.update([_det(10, 0)])
    assert math.isclose(speed, 10.0 * KMH_PER_PIXEL)  # 45.0


def test_average_of_multiple_tracked_vehicles():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    # Two vehicles, well separated so they never cross-associate.
    estimator.update([_det(0, 0), _det(0, 500)])
    # First moves 10 px, second moves 20 px -> speeds 45 and 90 -> avg 67.5.
    speed = estimator.update([_det(10, 0), _det(20, 500)])
    expected = (10.0 * KMH_PER_PIXEL + 20.0 * KMH_PER_PIXEL) / 2.0
    assert math.isclose(speed, expected)  # 67.5


def test_speed_is_clamped_to_max():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    estimator.update([_det(0, 0)])
    # Move 100 px/frame -> 100 * 4.5 = 450 km/h, must clamp to 200 (R3.4).
    speed = estimator.update([_det(100, 0)])
    assert speed == 200.0


def test_speed_never_negative_and_within_bounds_over_sequence():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    x = 0.0
    for _ in range(20):
        x += 7.0  # steady motion within the association gate
        speed = estimator.update([_det(x, 0)])
        assert 0.0 <= speed <= TEST_CONFIG.max_speed_kmh


def test_speed_drops_to_zero_when_vehicle_leaves():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    estimator.update([_det(0, 0)])
    estimator.update([_det(10, 0)])  # tracked -> non-zero
    # No detections this frame: nothing tracked across consecutive frames -> 0.
    assert estimator.update([]) == 0.0


def test_reset_clears_tracking_state():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    estimator.update([_det(0, 0)])
    estimator.update([_det(10, 0)])
    estimator.reset()
    # After reset the next frame is treated as a fresh first frame -> 0.0.
    assert estimator.update([_det(50, 0)]) == 0.0
    assert estimator.last_avg_speed == 0.0


def test_stationary_vehicle_reports_zero_speed():
    estimator = LaneSpeedEstimator(config=TEST_CONFIG)
    estimator.update([_det(0, 0)])
    # Same position across consecutive frames -> displacement 0 -> 0 km/h.
    assert estimator.update([_det(0, 0)]) == 0.0


# --- estimate_lane_speed convenience helper -------------------------------

def test_estimate_lane_speed_over_sequence():
    # Three frames: vehicle moves a steady 10 px/frame; final frame -> 45 km/h.
    frames = [[_det(0, 0)], [_det(10, 0)], [_det(20, 0)]]
    speed = estimate_lane_speed(frames, config=TEST_CONFIG)
    assert math.isclose(speed, 10.0 * KMH_PER_PIXEL)


def test_estimate_lane_speed_single_frame_is_zero():
    assert estimate_lane_speed([[_det(0, 0)]], config=TEST_CONFIG) == 0.0


def test_estimate_lane_speed_empty_sequence_is_zero():
    assert estimate_lane_speed([], config=TEST_CONFIG) == 0.0
