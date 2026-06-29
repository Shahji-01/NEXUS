"""Tests for emergency-vehicle recognition (stdlib-only).

Covers above-threshold recognition per canonical type, below-threshold rejection,
the indeterminate -> unknown/0.0 case, and the no-emergency -> None case
(Requirements 5.1, 5.3).
"""

from __future__ import annotations

import dataclasses

from app.config import config as default_config
from app.emergency import (
    EMERGENCY_TYPES,
    UNKNOWN_CONFIDENCE,
    UNKNOWN_TYPE,
    recognize_emergency,
)

# A clear above-threshold confidence (default emergency_confidence_min is 0.60).
ABOVE = 0.92
# A clear below-threshold confidence.
BELOW = 0.40
# The configured recognition threshold.
THRESHOLD = default_config.emergency_confidence_min


def _config_with_threshold(value: float):
    """A DetectorConfig copy with a custom emergency_confidence_min."""
    return dataclasses.replace(default_config, emergency_confidence_min=value)


# --- above-threshold recognition per type (R5.1) --------------------------

def test_recognizes_ambulance_above_threshold():
    result = recognize_emergency([{"class_name": "ambulance", "confidence": ABOVE}])
    assert result == {"type": "ambulance", "confidence": ABOVE}


def test_recognizes_fire_truck_above_threshold():
    result = recognize_emergency([{"class_name": "fire_truck", "confidence": ABOVE}])
    assert result == {"type": "fire_truck", "confidence": ABOVE}


def test_recognizes_police_above_threshold():
    result = recognize_emergency([{"class_name": "police", "confidence": ABOVE}])
    assert result == {"type": "police", "confidence": ABOVE}


def test_recognizes_at_exact_threshold_boundary():
    # "at or above" the configured minimum -> the boundary is recognised (R5.1).
    result = recognize_emergency([{"class_name": "ambulance", "confidence": THRESHOLD}])
    assert result == {"type": "ambulance", "confidence": THRESHOLD}


def test_label_normalization_maps_synonyms_to_canonical_types():
    assert recognize_emergency([{"label": "fire truck", "confidence": ABOVE}]) == {
        "type": "fire_truck",
        "confidence": ABOVE,
    }
    assert recognize_emergency([{"label": "firetruck", "confidence": ABOVE}]) == {
        "type": "fire_truck",
        "confidence": ABOVE,
    }
    assert recognize_emergency([{"label": "police car", "confidence": ABOVE}]) == {
        "type": "police",
        "confidence": ABOVE,
    }
    # Case-insensitive and whitespace-tolerant.
    assert recognize_emergency([{"name": "  AMBULANCE  ", "confidence": ABOVE}]) == {
        "type": "ambulance",
        "confidence": ABOVE,
    }


def test_picks_highest_confidence_emergency():
    detections = [
        {"class_name": "police", "confidence": 0.65},
        {"class_name": "ambulance", "confidence": 0.88},
        {"class_name": "fire_truck", "confidence": 0.70},
    ]
    assert recognize_emergency(detections) == {"type": "ambulance", "confidence": 0.88}


def test_recognizes_among_non_emergency_detections():
    detections = [
        {"class_name": "car", "confidence": 0.99},
        {"class_name": "truck", "confidence": 0.95},
        {"class_name": "ambulance", "confidence": ABOVE},
    ]
    assert recognize_emergency(detections) == {"type": "ambulance", "confidence": ABOVE}


# --- below-threshold rejection (R5.1) -------------------------------------

def test_below_threshold_typed_emergency_is_not_reported():
    # A typed emergency under the threshold does not, on its own, produce a result.
    result = recognize_emergency([{"class_name": "ambulance", "confidence": BELOW}])
    assert result is None


def test_just_below_threshold_rejected():
    just_below = THRESHOLD - 0.001
    result = recognize_emergency([{"class_name": "police", "confidence": just_below}])
    assert result is None


def test_custom_threshold_is_respected():
    cfg = _config_with_threshold(0.80)
    # 0.75 clears the default 0.60 but not this stricter 0.80 threshold.
    assert recognize_emergency(
        [{"class_name": "ambulance", "confidence": 0.75}], config=cfg
    ) is None
    assert recognize_emergency(
        [{"class_name": "ambulance", "confidence": 0.85}], config=cfg
    ) == {"type": "ambulance", "confidence": 0.85}


# --- indeterminate -> unknown / 0.0 (R5.3) --------------------------------

def test_generic_emergency_label_yields_unknown():
    result = recognize_emergency([{"label": "emergency_vehicle", "confidence": ABOVE}])
    assert result == {"type": UNKNOWN_TYPE, "confidence": UNKNOWN_CONFIDENCE}
    assert result == {"type": "unknown", "confidence": 0.0}


def test_generic_emergency_string_label_yields_unknown():
    result = recognize_emergency(["emergency"])
    assert result == {"type": "unknown", "confidence": 0.0}


def test_typed_emergency_below_threshold_with_generic_falls_back_to_unknown():
    # The typed detection is rejected (sub-threshold), but a generic emergency is
    # present -> indeterminate type (R5.3).
    detections = [
        {"class_name": "ambulance", "confidence": BELOW},
        {"label": "emergency vehicle", "confidence": ABOVE},
    ]
    assert recognize_emergency(detections) == {"type": "unknown", "confidence": 0.0}


def test_typed_recognition_takes_precedence_over_generic():
    # When both a valid typed emergency and a generic label are present, the
    # specific type wins (R5.1 over R5.3).
    detections = [
        {"label": "emergency", "confidence": ABOVE},
        {"class_name": "fire_truck", "confidence": ABOVE},
    ]
    assert recognize_emergency(detections) == {"type": "fire_truck", "confidence": ABOVE}


# --- no emergency -> None -------------------------------------------------

def test_no_detections_returns_none():
    assert recognize_emergency([]) is None


def test_only_regular_vehicles_returns_none():
    detections = [
        {"class_name": "car", "confidence": 0.99},
        {"class_name": "bike", "confidence": 0.80},
        {"class_name": "bus", "confidence": 0.91},
    ]
    assert recognize_emergency(detections) is None


def test_non_finite_or_missing_confidence_treated_as_zero():
    # Missing or non-finite confidences are treated as 0.0 -> below threshold.
    assert recognize_emergency([{"class_name": "ambulance"}]) is None
    assert recognize_emergency(
        [{"class_name": "police", "confidence": float("nan")}]
    ) is None


def test_emergency_types_constant_is_the_three_canonical_types():
    assert set(EMERGENCY_TYPES) == {"ambulance", "fire_truck", "police"}
