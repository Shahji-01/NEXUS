"""YOLO detection wrapper and COCO -> vehicle-class mapping.

This module implements the per-frame detection step of the NEXUS detector
pipeline (design: Python CV Microservice -> internal pipeline step 2 & 4).

It provides three things:

1. ``map_coco_label`` - a *pure* function that collapses the model's COCO-style
   class labels into the system Vehicle_Class set ``{car, bike, truck, bus}``.
   Two-wheelers and autos (motorcycle / bicycle / scooter / auto-rickshaw, etc.)
   map to ``bike`` per the design's Indian-traffic note (Requirement 2.2).
   Non-vehicle labels (``person``, ``traffic light``, ...) map to ``None``.

2. ``Detector`` - a thin wrapper around an ultralytics YOLO model that runs
   inference on a frame and returns a list of detections, each shaped as
   ``{class_name, bbox: [x, y, w, h], confidence}`` and filtered by
   ``config.detection_confidence_min`` (Requirements 2.1, 2.2, 2.3).
   The heavy ``ultralytics`` import is performed lazily inside ``_load_model``
   so this module imports cleanly in a bare environment (e.g. for unit tests).

3. ``aggregate_detections`` - a pure helper that folds a list of detections into
   per-class counts ``{cars, bikes, trucks, buses}`` plus a ``vehicle_count`` that
   equals the exact number of detected vehicles (Requirements 2.4, 6.3).

Requirements:
  - 2.1: detect vehicles present in a frame.
  - 2.2: classify each vehicle into exactly one of car / bike / truck / bus.
  - 2.3: report a confidence between 0.0 and 1.0 for each detection.
  - 2.4: the vehicle count equals the exact number of detected vehicles.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.config import DetectorConfig
from app.config import config as default_config

# The four canonical Vehicle_Class values (Requirement 2.2 / 6.x).
VEHICLE_CLASSES: tuple[str, str, str, str] = ("car", "bike", "truck", "bus")

# Direct COCO label -> Vehicle_Class translations. The standard COCO classes that
# represent road vehicles are: car, motorcycle, bicycle, bus, truck.
_COCO_TO_VEHICLE: Dict[str, str] = {
    "car": "car",
    "truck": "truck",
    "bus": "bus",
    # Two-wheelers collapse to "bike".
    "motorcycle": "bike",
    "motorbike": "bike",  # older COCO/YOLO label spelling
    "bicycle": "bike",
    "bike": "bike",
}

# Indian-traffic synonyms (autos / two-wheelers) that also collapse to "bike".
# Custom-trained models may emit these labels; the standard COCO set does not.
_EXTRA_BIKE_LABELS = frozenset(
    {
        "auto",
        "autorickshaw",
        "auto-rickshaw",
        "auto rickshaw",
        "rickshaw",
        "scooter",
        "scooty",
        "moped",
        "three-wheeler",
        "three wheeler",
        "tuk-tuk",
        "tuktuk",
    }
)


def map_coco_label(label: str) -> Optional[str]:
    """Map a COCO-style class label to a Vehicle_Class, or ``None``.

    Returns one of ``{"car", "bike", "truck", "bus"}`` for vehicle labels and
    ``None`` for any non-vehicle class (e.g. ``person``, ``traffic light``).

    The mapping is case-insensitive and tolerant of surrounding whitespace.
    Two-wheelers and autos map to ``"bike"`` (Requirement 2.2; design's
    Indian-traffic note).

    Args:
        label: The class label reported by the detection model.

    Returns:
        The mapped Vehicle_Class string, or ``None`` if the label is not a vehicle.
    """
    if not isinstance(label, str):
        return None

    normalized = label.strip().lower()
    if not normalized:
        return None

    if normalized in _COCO_TO_VEHICLE:
        return _COCO_TO_VEHICLE[normalized]
    if normalized in _EXTRA_BIKE_LABELS:
        return "bike"
    return None


@dataclass
class Detection:
    """A single mapped detection for one vehicle in one frame.

    Attributes:
        class_name: The mapped Vehicle_Class (one of ``VEHICLE_CLASSES``).
        bbox: Bounding box as ``[x, y, w, h]`` in pixel coordinates, where
            ``(x, y)`` is the top-left corner.
        confidence: Detection confidence in the range ``[0.0, 1.0]``.
    """

    class_name: str
    bbox: List[float]
    confidence: float

    def as_dict(self) -> Dict[str, Any]:
        """Serialisable view used by the detection endpoints and overlay."""
        return {
            "class_name": self.class_name,
            "bbox": list(self.bbox),
            "confidence": self.confidence,
        }


def _xyxy_to_xywh(x1: float, y1: float, x2: float, y2: float) -> List[float]:
    """Convert an ``(x1, y1, x2, y2)`` box to ``[x, y, w, h]`` (top-left + size)."""
    left = min(x1, x2)
    top = min(y1, y2)
    width = abs(x2 - x1)
    height = abs(y2 - y1)
    return [float(left), float(top), float(width), float(height)]


class Detector:
    """Runs YOLO inference on a frame and returns mapped vehicle detections.

    The ultralytics model is loaded lazily on first use so importing this module
    (and unit-testing the pure helpers) does not require the heavy ML stack.

    Args:
        model_path: Path/name of the YOLO weights to load (default ``yolov8n.pt``).
        config: Effective detector configuration; defaults to the module config.
    """

    def __init__(
        self,
        model_path: str = "yolov8n.pt",
        config: Optional[DetectorConfig] = None,
    ) -> None:
        self.model_path = model_path
        self.config = config or default_config
        self._model: Any = None

    def _load_model(self) -> Any:
        """Lazily import ultralytics and instantiate the YOLO model.

        Kept out of module import so the rest of the module works without the
        ``ultralytics`` dependency installed.
        """
        if self._model is None:
            try:
                from ultralytics import YOLO  # type: ignore import-not-found
            except ImportError as exc:  # pragma: no cover - exercised only w/o deps
                raise RuntimeError(
                    "ultralytics is not installed; cannot run YOLO inference. "
                    "Install the detector dependencies (see requirements.txt)."
                ) from exc
            self._model = YOLO(self.model_path)
        return self._model

    def detect(self, frame: Any) -> List[Dict[str, Any]]:
        """Detect vehicles in a single frame and return mapped detections.

        Runs YOLO inference, collapses each detection's COCO label to a
        Vehicle_Class, and keeps only vehicle detections whose confidence is at
        or above ``config.detection_confidence_min``.

        Args:
            frame: A single image/frame (e.g. an OpenCV BGR ``ndarray``).

        Returns:
            A list of detection dicts ``{class_name, bbox: [x, y, w, h], confidence}``.
            The list length equals the exact number of detected vehicles for the
            frame (Requirement 2.4).
        """
        model = self._load_model()
        # Smaller inference size + early confidence filtering make CPU inference
        # markedly faster with little accuracy loss for traffic-scale objects.
        imgsz = int(getattr(self.config, "inference_imgsz", 480) or 480)
        raw_results = model(
            frame,
            verbose=False,
            imgsz=imgsz,
            conf=self.config.detection_confidence_min,
        )
        return self._parse_results(raw_results)

    def _parse_results(self, raw_results: Any) -> List[Dict[str, Any]]:
        """Translate raw ultralytics results into mapped detection dicts.

        Handles the standard ultralytics ``Results`` container: a list whose
        first element exposes ``.boxes`` (with ``.xyxy``, ``.conf``, ``.cls``) and
        a ``.names`` index->label map.
        """
        if not raw_results:
            return []

        result = raw_results[0] if isinstance(raw_results, (list, tuple)) else raw_results
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []

        names = getattr(result, "names", None) or getattr(self._model, "names", {}) or {}
        min_conf = self.config.detection_confidence_min

        detections: List[Dict[str, Any]] = []
        for box in boxes:
            confidence = _scalar(getattr(box, "conf", None))
            class_idx = getattr(box, "cls", None)
            xyxy = getattr(box, "xyxy", None)
            if confidence is None or class_idx is None or xyxy is None:
                continue

            label = _label_for(names, _scalar(class_idx))
            class_name = map_coco_label(label)
            if class_name is None:
                continue
            if confidence < min_conf:
                continue

            coords = _coords(xyxy)
            if coords is None:
                continue
            x1, y1, x2, y2 = coords

            detections.append(
                Detection(
                    class_name=class_name,
                    bbox=_xyxy_to_xywh(x1, y1, x2, y2),
                    confidence=float(confidence),
                ).as_dict()
            )

        return detections


def aggregate_detections(detections: List[Dict[str, Any]]) -> Dict[str, int]:
    """Fold detections into per-class counts and a total vehicle count.

    Args:
        detections: A list of detection dicts as produced by ``Detector.detect``;
            each must carry a ``class_name`` field.

    Returns:
        A dict ``{cars, bikes, trucks, buses, vehicle_count}`` where
        ``vehicle_count`` equals ``cars + bikes + trucks + buses`` and is the
        exact number of detected vehicles (Requirements 2.4, 6.3). Detections
        with an unrecognised ``class_name`` are ignored so the per-class sums and
        the total stay consistent.
    """
    counts = {"car": 0, "bike": 0, "truck": 0, "bus": 0}
    for det in detections:
        class_name = det.get("class_name") if isinstance(det, dict) else None
        if class_name in counts:
            counts[class_name] += 1

    cars = counts["car"]
    bikes = counts["bike"]
    trucks = counts["truck"]
    buses = counts["bus"]
    return {
        "cars": cars,
        "bikes": bikes,
        "trucks": trucks,
        "buses": buses,
        "vehicle_count": cars + bikes + trucks + buses,
    }


def _scalar(value: Any) -> Any:
    """Coerce a possibly-tensor/array/1-element-sequence value to a Python scalar.

    Tolerates ultralytics tensors (``.item()``), numpy arrays/0-d values, and
    plain Python sequences/numbers without importing torch or numpy.
    """
    if value is None:
        return None
    # Tensors / numpy scalars expose .item()
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return item()
        except (ValueError, TypeError):
            pass
    # Sequences / arrays: take the first element.
    try:
        return value[0]
    except (TypeError, KeyError, IndexError):
        return value


def _coords(xyxy: Any) -> Optional[tuple[float, float, float, float]]:
    """Extract four box coordinates from an ultralytics xyxy box value."""
    # A single box's xyxy is typically shaped (1, 4); normalise to a flat row.
    candidate = xyxy
    first = None
    try:
        first = xyxy[0]
    except (TypeError, KeyError, IndexError):
        first = None
    if first is not None and hasattr(first, "__len__") and len(first) == 4:
        candidate = first
    try:
        x1, y1, x2, y2 = (float(_scalar_num(candidate[i])) for i in range(4))
    except (TypeError, KeyError, IndexError, ValueError):
        return None
    return x1, y1, x2, y2


def _scalar_num(value: Any) -> float:
    """Coerce a tensor/array element to a float."""
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return float(item())
        except (ValueError, TypeError):
            pass
    return float(value)


def _label_for(names: Any, class_idx: Any) -> str:
    """Resolve a class index to its label using the model's names map."""
    if class_idx is None:
        return ""
    try:
        idx = int(class_idx)
    except (TypeError, ValueError):
        return ""
    if isinstance(names, dict):
        return str(names.get(idx, ""))
    try:
        return str(names[idx])
    except (TypeError, KeyError, IndexError):
        return ""
