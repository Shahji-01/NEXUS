"""Emergency-vehicle recognition (pure, dependency-light).

This module implements the emergency-vehicle recognition step of the NEXUS
detector pipeline (design: Python CV Microservice -> internal pipeline step 4,
Requirement 5). It is intentionally dependency-light (standard library only):
no cv2, numpy, or ML imports are required, so it can be imported and unit-tested
in a bare environment.

It provides a single pure function, :func:`recognize_emergency`, that inspects a
lane's detections/labels (each carrying a confidence) and decides whether an
Emergency_Vehicle should be reported for that lane:

  * WHEN an emergency-vehicle class (``ambulance`` / ``fire_truck`` / ``police``)
    is detected at or above ``config.emergency_confidence_min``, the function
    returns ``{"type": <that type>, "confidence": <conf>}`` (Requirement 5.1).
  * WHEN an emergency vehicle is detected/suspected but its specific type cannot
    be determined, the function returns ``{"type": "unknown", "confidence": 0.0}``
    (Requirement 5.3).
  * WHEN no emergency vehicle is present, the function returns ``None``.

A label-normalization map collapses the various label spellings a model may emit
(e.g. ``"fire truck"`` / ``"firetruck"`` / ``"fire_truck"``, ``"police car"``)
onto the three canonical Emergency_Vehicle types.

Requirements:
  - 5.1: report an Emergency_Vehicle type of ``ambulance`` / ``fire_truck`` /
    ``police`` when detected with confidence at or above the configured minimum.
  - 5.3: when an emergency vehicle is detected but its type is indeterminate,
    produce a default type of ``unknown`` with a confidence of ``0.0``.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable, Optional

from app.config import DetectorConfig
from app.config import config as default_config

# The three canonical Emergency_Vehicle types (Requirement 5.1).
EMERGENCY_TYPES: tuple[str, str, str] = ("ambulance", "fire_truck", "police")

# Default type/confidence reported when an emergency vehicle is detected but its
# specific type cannot be determined (Requirement 5.3).
UNKNOWN_TYPE = "unknown"
UNKNOWN_CONFIDENCE = 0.0

# Label-normalization map: model label spellings -> canonical Emergency_Vehicle
# type. Lookups are case-insensitive and whitespace-tolerant (see _canonical_type).
_LABEL_TO_TYPE: Dict[str, str] = {
    # Ambulance
    "ambulance": "ambulance",
    "ambulance van": "ambulance",
    "emergency ambulance": "ambulance",
    # Fire truck
    "fire_truck": "fire_truck",
    "fire truck": "fire_truck",
    "firetruck": "fire_truck",
    "fire-truck": "fire_truck",
    "fire engine": "fire_truck",
    "fire_engine": "fire_truck",
    "fireengine": "fire_truck",
    # Police
    "police": "police",
    "police car": "police",
    "police_car": "police",
    "policecar": "police",
    "police van": "police",
    "cop car": "police",
    "patrol car": "police",
}

# Generic labels that indicate an emergency vehicle is present/suspected without
# pinning down its specific type. These trigger the indeterminate-type path
# (Requirement 5.3) rather than naming one of the canonical types.
_GENERIC_EMERGENCY_LABELS = frozenset(
    {
        "emergency",
        "emergency vehicle",
        "emergency_vehicle",
        "emergency-vehicle",
        "siren",
    }
)


def _normalize_label(label: Any) -> str:
    """Lower-case and collapse internal whitespace of a label, or ``""``."""
    if not isinstance(label, str):
        return ""
    return " ".join(label.strip().lower().split())


def _canonical_type(label: Any) -> Optional[str]:
    """Map a raw label to a canonical Emergency_Vehicle type, or ``None``.

    Returns one of ``EMERGENCY_TYPES`` for recognised emergency-vehicle labels
    (case-insensitive, whitespace-tolerant), or ``None`` for any other label.
    Generic emergency labels (``"emergency"``, ``"siren"``, ...) are *not*
    canonical types and return ``None`` here; they are handled separately as the
    indeterminate case.
    """
    return _LABEL_TO_TYPE.get(_normalize_label(label))


def _is_generic_emergency(label: Any) -> bool:
    """True if ``label`` indicates a (type-indeterminate) emergency vehicle."""
    return _normalize_label(label) in _GENERIC_EMERGENCY_LABELS


def _confidence_of(item: Any) -> float:
    """Extract a finite confidence in ``[0, 1]`` from a detection-like item.

    Accepts a mapping with a ``confidence`` (or ``conf``) key. Non-finite or
    missing confidences are treated as ``0.0`` and the result is clamped to
    ``[0, 1]`` so threshold comparisons are always well-defined.
    """
    raw: Any = None
    if isinstance(item, dict):
        raw = item.get("confidence", item.get("conf"))
    if raw is None:
        return 0.0
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(value):
        return 0.0
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _label_of(item: Any) -> Any:
    """Extract a label from a detection-like item.

    Accepts either a plain string label or a mapping carrying the label under one
    of the common keys (``class_name``, ``label``, ``class``, ``name``, ``type``).
    """
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        for key in ("class_name", "label", "class", "name", "type"):
            if key in item:
                return item[key]
    return None


def recognize_emergency(
    detections: Iterable[Any],
    config: Optional[DetectorConfig] = None,
) -> Optional[Dict[str, Any]]:
    """Recognise an Emergency_Vehicle for a lane from its detections.

    Inspects a lane's detections/labels (each optionally carrying a confidence)
    and returns the emergency result for that lane:

      * If any detection maps to a canonical Emergency_Vehicle type
        (``ambulance`` / ``fire_truck`` / ``police``) with confidence at or above
        ``config.emergency_confidence_min``, returns
        ``{"type": <type>, "confidence": <conf>}`` for the highest-confidence such
        detection (Requirement 5.1).
      * Otherwise, if an emergency vehicle is detected/suspected but its specific
        type cannot be determined - either a generic emergency label, or a typed
        emergency detection that only clears the threshold without a usable type -
        returns ``{"type": "unknown", "confidence": 0.0}`` (Requirement 5.3).
      * Otherwise returns ``None``.

    Detections below the configured threshold are ignored: a sub-threshold typed
    emergency detection does not, on its own, produce a result.

    Args:
        detections: An iterable of detection items. Each item may be a label
            string or a mapping carrying a label (``class_name``/``label``/...)
            and a ``confidence``/``conf`` value.
        config: Effective detector configuration; defaults to the module config.
            ``config.emergency_confidence_min`` is the recognition threshold.

    Returns:
        An emergency result dict ``{"type", "confidence"}``, or ``None`` when no
        emergency vehicle is present.
    """
    cfg = config or default_config
    threshold = cfg.emergency_confidence_min

    best_type: Optional[str] = None
    best_confidence = -1.0
    saw_generic_emergency = False

    for item in detections:
        label = _label_of(item)
        confidence = _confidence_of(item)

        canonical = _canonical_type(label)
        if canonical is not None:
            # A typed emergency vehicle: only counts at/above the threshold (R5.1).
            if confidence >= threshold and confidence > best_confidence:
                best_type = canonical
                best_confidence = confidence
            continue

        if _is_generic_emergency(label):
            # An emergency vehicle of indeterminate type was detected (R5.3).
            saw_generic_emergency = True

    if best_type is not None:
        return {"type": best_type, "confidence": best_confidence}

    if saw_generic_emergency:
        return {"type": UNKNOWN_TYPE, "confidence": UNKNOWN_CONFIDENCE}

    return None
