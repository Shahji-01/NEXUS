"""Tests for density derivation and congestion classification (stdlib-only).

Covers the Congestion_Level threshold boundaries (exactly 30, 55, 80) and density
clamping/coercion for negative, >100, and NaN inputs (Requirement 4.1-4.5).
"""

from __future__ import annotations

import math

from app.density import (
    DEFAULT_LANE_CAPACITY,
    compute_density,
    congestion_level,
    density_from_detections,
)


# --- congestion_level: threshold boundaries (R4.2-4.5) --------------------

def test_congestion_low_at_and_below_30():
    # density <= 30 -> low (boundary exactly 30 is low).
    assert congestion_level(0) == "low"
    assert congestion_level(30) == "low"
    assert congestion_level(30.0) == "low"


def test_congestion_medium_above_30_through_55():
    # 30 < density <= 55 -> medium (boundary exactly 55 is medium).
    assert congestion_level(30.1) == "medium"
    assert congestion_level(45) == "medium"
    assert congestion_level(55) == "medium"


def test_congestion_high_above_55_through_80():
    # 55 < density <= 80 -> high (boundary exactly 80 is high).
    assert congestion_level(55.1) == "high"
    assert congestion_level(70) == "high"
    assert congestion_level(80) == "high"


def test_congestion_critical_above_80():
    # density > 80 -> critical.
    assert congestion_level(80.1) == "critical"
    assert congestion_level(95) == "critical"
    assert congestion_level(100) == "critical"


def test_congestion_level_coerces_non_finite_to_low():
    assert congestion_level(float("nan")) == "low"
    # +inf is > 80 so it classifies as critical only if treated as finite; we
    # coerce non-finite to 0 -> low, keeping the function total and predictable.
    assert congestion_level(float("inf")) == "low"
    assert congestion_level(float("-inf")) == "low"


# --- compute_density: clamping & coercion (R4.1) --------------------------

def test_density_is_zero_for_no_vehicles():
    assert compute_density(0) == 0.0


def test_density_clamped_to_100_for_excessive_count():
    # Far more vehicles than capacity must clamp to 100, not overflow.
    assert compute_density(1000) == 100.0


def test_density_clamped_to_zero_for_negative_count():
    assert compute_density(-5) == 0.0


def test_density_nan_coerced_to_zero():
    assert compute_density(float("nan")) == 0.0


def test_density_infinite_coerced_to_zero():
    assert compute_density(float("inf")) == 0.0
    assert compute_density(float("-inf")) == 0.0


def test_density_none_coerced_to_zero():
    assert compute_density(None) == 0.0


def test_density_proportional_to_count():
    # Half capacity -> ~50% density (count-only path).
    assert compute_density(DEFAULT_LANE_CAPACITY / 2) == 50.0
    assert compute_density(DEFAULT_LANE_CAPACITY) == 100.0


def test_density_always_within_bounds_across_range():
    for count in range(-10, 60):
        d = compute_density(count)
        assert 0.0 <= d <= 100.0
        assert math.isfinite(d)


# --- compute_density: area-based blending ---------------------------------

def test_density_blends_count_and_area():
    # count component: 10/20*100 = 50; area component: 50% occupancy = 50.
    d = compute_density(vehicle_count=10, bbox_area=5000, frame_area=10000)
    assert d == 50.0


def test_density_area_ignored_when_frame_area_non_positive():
    # frame_area <= 0 disables the area component; falls back to count-only.
    d = compute_density(vehicle_count=10, bbox_area=5000, frame_area=0)
    assert d == 50.0


def test_density_area_clamped_when_bbox_exceeds_frame():
    # Overlapping boxes can sum beyond the frame area; result still clamps to 100.
    d = compute_density(vehicle_count=100, bbox_area=99999, frame_area=10000)
    assert d == 100.0


def test_density_handles_non_finite_capacity():
    # A bad capacity falls back to the default capacity instead of producing nan.
    d = compute_density(vehicle_count=10, capacity=float("nan"))
    assert d == 50.0


# --- density_from_detections convenience wrapper --------------------------

def test_density_from_detections_counts_and_sums_area():
    detections = [
        {"class_name": "car", "bbox": [0, 0, 50, 50], "confidence": 0.9},
        {"class_name": "bike", "bbox": [0, 0, 50, 50], "confidence": 0.8},
    ]
    # 2 vehicles -> count density 2/20*100 = 10; area = 2*2500 = 5000 of 10000 -> 50.
    d = density_from_detections(detections, frame_area=10000)
    expected = round(0.6 * 10.0 + 0.4 * 50.0, 1)
    assert d == expected


def test_density_from_detections_empty_is_zero():
    assert density_from_detections([], frame_area=10000) == 0.0


def test_density_from_detections_tolerates_missing_bbox():
    detections = [{"class_name": "car"}, {"class_name": "bus", "bbox": None}]
    # Both counted (2 vehicles), no usable area -> area component is 0.
    d = density_from_detections(detections, frame_area=10000)
    expected = round(0.6 * (2 / DEFAULT_LANE_CAPACITY * 100.0) + 0.4 * 0.0, 1)
    assert d == expected
