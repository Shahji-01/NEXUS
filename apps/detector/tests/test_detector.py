"""Unit tests for the detection module (stdlib-only, no CV / ML deps required).

These exercise the pure logic of ``app.detector``:
  - ``map_coco_label``: COCO -> Vehicle_Class mapping (Requirement 2.2).
  - ``aggregate_detections``: per-class counts + exact vehicle_count (R2.4, R6.3).
  - ``Detector._parse_results``: parsing fake YOLO output with confidence
    filtering and bbox conversion (Requirements 2.1, 2.2, 2.3, 2.4), using a fake
    model so no real ultralytics inference runs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List

import pytest

from app.config import DetectorConfig
from app.detector import (
    VEHICLE_CLASSES,
    Detector,
    aggregate_detections,
    map_coco_label,
)


# --- map_coco_label -------------------------------------------------------


@pytest.mark.parametrize(
    "label,expected",
    [
        ("car", "car"),
        ("truck", "truck"),
        ("bus", "bus"),
        ("motorcycle", "bike"),
        ("motorbike", "bike"),
        ("bicycle", "bike"),
    ],
)
def test_map_coco_label_known_vehicles(label, expected):
    assert map_coco_label(label) == expected


@pytest.mark.parametrize(
    "label",
    ["auto", "autorickshaw", "rickshaw", "scooter", "moped", "tuktuk"],
)
def test_map_coco_label_indian_two_wheelers_and_autos_map_to_bike(label):
    # Design's Indian-traffic note: two-wheelers / autos collapse to "bike".
    assert map_coco_label(label) == "bike"


@pytest.mark.parametrize(
    "label",
    ["person", "traffic light", "stop sign", "dog", "boat", "airplane", ""],
)
def test_map_coco_label_non_vehicles_return_none(label):
    assert map_coco_label(label) is None


def test_map_coco_label_is_case_and_whitespace_insensitive():
    assert map_coco_label("  CAR ") == "car"
    assert map_coco_label("Motorcycle") == "bike"


def test_map_coco_label_handles_non_string():
    assert map_coco_label(None) is None  # type: ignore[arg-type]
    assert map_coco_label(7) is None  # type: ignore[arg-type]


def test_map_coco_label_only_returns_valid_vehicle_classes():
    for label in ["car", "truck", "bus", "motorcycle", "bicycle", "auto"]:
        assert map_coco_label(label) in VEHICLE_CLASSES


# --- aggregate_detections -------------------------------------------------


def _det(class_name: str, conf: float = 0.9) -> dict:
    return {"class_name": class_name, "bbox": [0, 0, 10, 10], "confidence": conf}


def test_aggregate_empty_is_all_zero():
    result = aggregate_detections([])
    assert result == {"cars": 0, "bikes": 0, "trucks": 0, "buses": 0, "vehicle_count": 0}


def test_aggregate_counts_per_class():
    detections = [
        _det("car"),
        _det("car"),
        _det("bike"),
        _det("truck"),
        _det("bus"),
        _det("bus"),
    ]
    result = aggregate_detections(detections)
    assert result["cars"] == 2
    assert result["bikes"] == 1
    assert result["trucks"] == 1
    assert result["buses"] == 2


def test_aggregate_vehicle_count_equals_sum_of_classes():
    detections = [_det("car"), _det("bike"), _det("bike"), _det("truck")]
    result = aggregate_detections(detections)
    assert result["vehicle_count"] == (
        result["cars"] + result["bikes"] + result["trucks"] + result["buses"]
    )
    # Exact number of detected vehicles (Requirement 2.4).
    assert result["vehicle_count"] == len(detections)


def test_aggregate_ignores_unknown_class_names():
    detections = [_det("car"), _det("person"), _det("unknown")]
    result = aggregate_detections(detections)
    assert result["cars"] == 1
    assert result["vehicle_count"] == 1


# --- Detector parsing with a fake model -----------------------------------


@dataclass
class FakeBox:
    """Mimics one ultralytics box with .conf / .cls / .xyxy attributes."""

    conf: float
    cls: int
    xyxy: List[List[float]]


class FakeResult:
    """Mimics an ultralytics Results object: iterable .boxes + .names map."""

    def __init__(self, boxes: List[FakeBox], names: dict):
        self.boxes = boxes
        self.names = names


class FakeYOLO:
    """Stands in for ultralytics.YOLO; returns canned results on call."""

    # COCO indices: 2=car, 3=motorcycle, 5=bus, 7=truck, 0=person, 1=bicycle
    NAMES = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

    def __init__(self, boxes: List[FakeBox]):
        self._boxes = boxes

    def __call__(self, frame: Any, verbose: bool = False, **kwargs):  # noqa: D401
        return [FakeResult(self._boxes, self.NAMES)]


def _make_detector(boxes: List[FakeBox], min_conf: float = 0.35) -> Detector:
    detector = Detector(config=DetectorConfig(detection_confidence_min=min_conf))
    # Inject the fake model directly so no real ultralytics load happens.
    detector._model = FakeYOLO(boxes)
    return detector


def test_detect_maps_and_converts_bbox_to_xywh():
    # car at (10,20)-(50,80) -> [10, 20, 40, 60]
    boxes = [FakeBox(conf=0.9, cls=2, xyxy=[[10.0, 20.0, 50.0, 80.0]])]
    detections = _make_detector(boxes).detect(frame=object())
    assert len(detections) == 1
    det = detections[0]
    assert det["class_name"] == "car"
    assert det["bbox"] == [10.0, 20.0, 40.0, 60.0]
    assert det["confidence"] == pytest.approx(0.9)


def test_detect_collapses_motorcycle_and_bicycle_to_bike():
    boxes = [
        FakeBox(conf=0.8, cls=3, xyxy=[[0, 0, 10, 10]]),  # motorcycle
        FakeBox(conf=0.8, cls=1, xyxy=[[0, 0, 10, 10]]),  # bicycle
    ]
    detections = _make_detector(boxes).detect(frame=object())
    assert [d["class_name"] for d in detections] == ["bike", "bike"]


def test_detect_filters_below_confidence_threshold():
    boxes = [
        FakeBox(conf=0.9, cls=2, xyxy=[[0, 0, 10, 10]]),  # kept
        FakeBox(conf=0.2, cls=7, xyxy=[[0, 0, 10, 10]]),  # dropped (< 0.35)
    ]
    detections = _make_detector(boxes, min_conf=0.35).detect(frame=object())
    assert len(detections) == 1
    assert detections[0]["class_name"] == "car"


def test_detect_drops_non_vehicle_classes():
    boxes = [
        FakeBox(conf=0.99, cls=0, xyxy=[[0, 0, 10, 10]]),  # person -> dropped
        FakeBox(conf=0.99, cls=5, xyxy=[[0, 0, 10, 10]]),  # bus -> kept
    ]
    detections = _make_detector(boxes).detect(frame=object())
    assert len(detections) == 1
    assert detections[0]["class_name"] == "bus"


def test_detect_vehicle_count_equals_exact_detections():
    boxes = [
        FakeBox(conf=0.9, cls=2, xyxy=[[0, 0, 10, 10]]),  # car
        FakeBox(conf=0.9, cls=2, xyxy=[[0, 0, 10, 10]]),  # car
        FakeBox(conf=0.9, cls=7, xyxy=[[0, 0, 10, 10]]),  # truck
        FakeBox(conf=0.1, cls=5, xyxy=[[0, 0, 10, 10]]),  # bus (dropped, low conf)
        FakeBox(conf=0.9, cls=0, xyxy=[[0, 0, 10, 10]]),  # person (dropped)
    ]
    detections = _make_detector(boxes).detect(frame=object())
    agg = aggregate_detections(detections)
    # Exactly 3 vehicles survive filtering (Requirement 2.4).
    assert agg["vehicle_count"] == 3
    assert len(detections) == 3
