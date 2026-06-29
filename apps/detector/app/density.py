"""Density derivation and congestion-level classification.

This module implements the density/congestion step of the NEXUS detector
pipeline (design: Python CV Microservice -> internal pipeline step 5,
Requirement 4). It is intentionally dependency-light (standard library only):
no cv2, numpy, or ML imports are required, so it can be imported and unit-tested
in a bare environment.

It provides two pure functions:

1. ``congestion_level(density)`` - maps a density value to one of the four
   Congestion_Level strings using the *exact* thresholds used by the Node
   simulation source (``apps/api/src/lib/simulation.ts`` ``congestionLevel``):
   ``> 80`` -> ``critical``, ``> 55`` -> ``high``, ``> 30`` -> ``medium``,
   else ``low`` (Requirements 4.2, 4.3, 4.4, 4.5). Keeping these in lock-step
   guarantees identical classification across the simulation and video sources.

2. ``compute_density(...)`` - derives a density value bounded to ``[0, 100]``
   from detection results using an occupancy/flow heuristic based on the vehicle
   count and (optionally) the summed bounding-box area relative to the frame
   area (Requirement 4.1). Non-finite inputs (``NaN``/``inf``) and negatives are
   coerced so the result is always a finite value within ``[0, 100]``.

Requirements:
  - 4.1: compute a density value bounded to the range 0 to 100 for each Lane.
  - 4.2: density > 80 -> critical.
  - 4.3: 55 < density <= 80 -> high.
  - 4.4: 30 < density <= 55 -> medium.
  - 4.5: density <= 30 -> low.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Optional

from app.config import (
    CONGESTION_CRITICAL_MIN,
    CONGESTION_HIGH_MIN,
    CONGESTION_MEDIUM_MIN,
)

# Default lane "capacity": the number of vehicles that saturates a lane (maps to
# 100% count-based occupancy). Chosen to mirror the Node simulation, where a lane
# total of ~20 vehicles corresponds to 100% density ((total / 20) * 100).
DEFAULT_LANE_CAPACITY = 20.0

# Blend weight for the count-based component when both the count-based and the
# bbox-area-based occupancy estimates are available. The remaining weight goes to
# the area-based estimate. A count-leaning blend keeps the result aligned with the
# simulation's count-driven density while still reacting to large-vehicle occupancy.
_COUNT_WEIGHT = 0.6


def congestion_level(density: float) -> str:
    """Classify a density value into a Congestion_Level string.

    Uses the exact thresholds shared with the Node simulation source so the two
    data sources classify congestion identically (Requirement 4.2-4.5):

      * ``density > 80``                -> ``"critical"``
      * ``55 < density <= 80``          -> ``"high"``
      * ``30 < density <= 55``          -> ``"medium"``
      * ``density <= 30``               -> ``"low"``

    Non-finite input (``NaN``/``inf``) is coerced to ``0.0`` (-> ``"low"``) so the
    function is total and never raises.

    Args:
        density: A density value, normally within ``[0, 100]``.

    Returns:
        One of ``"low"``, ``"medium"``, ``"high"``, ``"critical"``.
    """
    value = _finite_or_zero(density)
    if value > CONGESTION_CRITICAL_MIN:
        return "critical"
    if value > CONGESTION_HIGH_MIN:
        return "high"
    if value > CONGESTION_MEDIUM_MIN:
        return "medium"
    return "low"


def compute_density(
    vehicle_count: Any,
    bbox_area: Optional[Any] = None,
    frame_area: Optional[Any] = None,
    capacity: float = DEFAULT_LANE_CAPACITY,
) -> float:
    """Derive a density value bounded to ``[0, 100]`` from detection results.

    The heuristic combines up to two occupancy signals:

      * **Count-based occupancy** - ``vehicle_count / capacity`` as a percentage.
        This mirrors the simulation's count-driven density.
      * **Area-based occupancy** - the summed detection bounding-box area as a
        fraction of the frame area, as a percentage. Used only when both
        ``bbox_area`` and a positive ``frame_area`` are supplied.

    When both signals are available they are blended (``_COUNT_WEIGHT`` on the
    count component); otherwise the available signal is used alone. The result is
    clamped to ``[0, 100]`` and rounded to one decimal place (matching the
    simulation's density precision).

    All inputs are coerced defensively: non-finite values (``NaN``/``inf``) and
    negatives become ``0`` so the output is always a finite value in ``[0, 100]``
    (Requirement 4.1).

    Args:
        vehicle_count: The number of detected vehicles in the lane.
        bbox_area: Optional summed bounding-box area (pixels^2) of detections.
        frame_area: Optional frame area (pixels^2); must be positive to be used.
        capacity: Vehicle count that saturates the lane (maps to 100%).

    Returns:
        A density value in ``[0, 100]`` rounded to one decimal place.
    """
    count = _finite_or_zero(vehicle_count)
    if count < 0:
        count = 0.0

    safe_capacity = _finite_or_zero(capacity)
    if safe_capacity <= 0:
        safe_capacity = DEFAULT_LANE_CAPACITY
    count_density = (count / safe_capacity) * 100.0

    area_density = _area_density(bbox_area, frame_area)

    if area_density is None:
        density = count_density
    else:
        density = _COUNT_WEIGHT * count_density + (1.0 - _COUNT_WEIGHT) * area_density

    return round(_clamp(density, 0.0, 100.0), 1)


def density_from_detections(
    detections: Iterable[Any],
    frame_area: Optional[Any] = None,
    capacity: float = DEFAULT_LANE_CAPACITY,
) -> float:
    """Convenience wrapper deriving density from a list of detection dicts.

    Counts the detections and sums their bounding-box areas (each detection's
    ``bbox`` is ``[x, y, w, h]``), then defers to :func:`compute_density`.
    Detections without a usable ``bbox`` contribute to the count but not the area.

    Args:
        detections: An iterable of detection dicts (e.g. from ``Detector.detect``).
        frame_area: Optional frame area (pixels^2) for the area-based component.
        capacity: Vehicle count that saturates the lane (maps to 100%).

    Returns:
        A density value in ``[0, 100]`` rounded to one decimal place.
    """
    count = 0
    total_area = 0.0
    for det in detections:
        count += 1
        total_area += _bbox_area(det)
    return compute_density(
        vehicle_count=count,
        bbox_area=total_area,
        frame_area=frame_area,
        capacity=capacity,
    )


def _area_density(bbox_area: Optional[Any], frame_area: Optional[Any]) -> Optional[float]:
    """Compute the area-based occupancy percentage, or ``None`` if unavailable."""
    if bbox_area is None or frame_area is None:
        return None
    area = _finite_or_zero(bbox_area)
    frame = _finite_or_zero(frame_area)
    if area < 0:
        area = 0.0
    if frame <= 0:
        return None
    return (area / frame) * 100.0


def _bbox_area(detection: Any) -> float:
    """Extract the ``w * h`` area from a detection dict's ``bbox`` ``[x, y, w, h]``."""
    if not isinstance(detection, dict):
        return 0.0
    bbox = detection.get("bbox")
    try:
        width = _finite_or_zero(bbox[2])
        height = _finite_or_zero(bbox[3])
    except (TypeError, KeyError, IndexError):
        return 0.0
    if width < 0 or height < 0:
        return 0.0
    return width * height


def _finite_or_zero(value: Any) -> float:
    """Coerce ``value`` to a finite float, mapping ``None``/``NaN``/``inf`` to 0.0."""
    if value is None:
        return 0.0
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(result):
        return 0.0
    return result


def _clamp(value: float, low: float, high: float) -> float:
    """Clamp ``value`` to the inclusive range ``[low, high]``."""
    if value < low:
        return low
    if value > high:
        return high
    return value
