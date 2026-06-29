"""Cross-frame vehicle tracking and per-lane speed estimation.

This module implements step 3 of the detector pipeline (design: "A lightweight
tracker assigns stable IDs across frames; per-pixel displacement between frames
+ a configured ``meters_per_pixel`` + clip FPS yields per-vehicle speed,
averaged per lane and bounded to ``[0, 200]`` km/h"). It is intentionally
**pure Python / standard-library only** so it can be imported and unit-tested
without OpenCV, numpy, torch, or the ultralytics ML stack installed (mirroring
the dependency-light pattern used by ``app.config`` and ``app.video_loop``).

It provides:

1. ``CentroidTracker`` - a greedy nearest-centroid tracker that assigns stable,
   monotonically-increasing track IDs to detections across consecutive frames
   by matching bounding-box centroids within a distance gate (Requirement 3.1).
   No ML/optical-flow dependency: matching is a pure geometric nearest-neighbour
   association, which keeps it deterministic and testable.

2. ``LaneSpeedEstimator`` - consumes the per-frame detections for a single lane
   and maintains the tracker plus the previous-frame centroids. Each ``update``
   advances exactly one frame and returns the per-lane average speed in km/h:
     pixel displacement of a track's centroid between two *consecutive* frames
       x ``meters_per_pixel``           (pixels -> metres travelled per frame)
       x ``fps``                        (per-frame -> per-second  => m/s)
       x 3.6                            (m/s -> km/h)
   averaged across all vehicles tracked across consecutive frames, then bounded
   to ``[0, max_speed_kmh]`` (Requirements 3.2, 3.4). When no vehicle is tracked
   across two or more consecutive frames, it reports ``0.0`` (Requirement 3.3).

Requirements:
  - 3.1: track detected vehicles across consecutive frames within a lane.
  - 3.2: when >=1 vehicle is tracked across >=2 consecutive frames, report the
         computed average speed in km/h.
  - 3.3: when nothing is tracked across consecutive frames, report 0.
  - 3.4: bound reported average speed to [0, 200] km/h.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.config import DetectorConfig
from app.config import config as default_config

# A 2D point in pixel coordinates.
Centroid = Tuple[float, float]

# Default association gate (pixels). Two centroids further apart than this are
# never considered the same vehicle between consecutive frames. Kept generous
# enough for fast-moving vehicles at typical clip resolutions while still
# preventing obviously-wrong cross-associations.
DEFAULT_MAX_MATCH_DISTANCE = 120.0

# How many consecutive frames a track may be missing before it is dropped.
# A small value keeps stale IDs from lingering across long occlusions.
DEFAULT_MAX_DISAPPEARED = 5


def bbox_centroid(bbox: Sequence[float]) -> Centroid:
    """Return the centre point ``(cx, cy)`` of an ``[x, y, w, h]`` bbox.

    ``(x, y)`` is the top-left corner and ``(w, h)`` the width/height, matching
    the detection shape produced by ``app.detector`` (``Detection.bbox``).
    """
    x, y, w, h = (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
    return (x + w / 2.0, y + h / 2.0)


def _distance(a: Centroid, b: Centroid) -> float:
    """Euclidean distance between two centroids."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass
class CentroidTracker:
    """Greedy nearest-centroid tracker assigning stable IDs across frames.

    The tracker keeps the latest centroid for each live track. On every
    ``update`` it associates incoming centroids to existing tracks by repeatedly
    choosing the globally-nearest (track, detection) pair whose distance is
    within ``max_match_distance``. Unmatched detections register as new tracks;
    unmatched tracks age out after ``max_disappeared`` consecutive misses.

    Attributes:
        max_match_distance: Distance gate (pixels) for association.
        max_disappeared: Consecutive missed frames before a track is removed.
    """

    max_match_distance: float = DEFAULT_MAX_MATCH_DISTANCE
    max_disappeared: int = DEFAULT_MAX_DISAPPEARED

    _next_id: int = field(default=0, init=False)
    _tracks: Dict[int, Centroid] = field(default_factory=dict, init=False)
    _disappeared: Dict[int, int] = field(default_factory=dict, init=False)

    @property
    def tracks(self) -> Dict[int, Centroid]:
        """Current live track id -> latest centroid (read-only view copy)."""
        return dict(self._tracks)

    def _register(self, centroid: Centroid) -> int:
        track_id = self._next_id
        self._next_id += 1
        self._tracks[track_id] = centroid
        self._disappeared[track_id] = 0
        return track_id

    def _deregister(self, track_id: int) -> None:
        self._tracks.pop(track_id, None)
        self._disappeared.pop(track_id, None)

    def update(self, centroids: Sequence[Centroid]) -> Dict[int, Centroid]:
        """Advance one frame and return the ``track_id -> centroid`` assignment.

        Args:
            centroids: The detection centroids observed in the current frame.

        Returns:
            A mapping of track id to centroid for tracks matched or created in
            **this** frame. Tracks that were not observed this frame are not
            included in the returned mapping (but may still be live and eligible
            to re-match on a later frame until they age out).
        """
        # No detections this frame: age every live track, drop the stale ones.
        if not centroids:
            for track_id in list(self._disappeared.keys()):
                self._disappeared[track_id] += 1
                if self._disappeared[track_id] > self.max_disappeared:
                    self._deregister(track_id)
            return {}

        # No existing tracks: every detection starts a new track.
        if not self._tracks:
            return {self._register(c): c for c in centroids}

        track_ids = list(self._tracks.keys())

        # Build all candidate (distance, track_id, detection_index) pairs within
        # the gate, then greedily consume the closest non-conflicting pairs.
        candidates: List[Tuple[float, int, int]] = []
        for track_id in track_ids:
            tc = self._tracks[track_id]
            for det_idx, c in enumerate(centroids):
                dist = _distance(tc, c)
                if dist <= self.max_match_distance:
                    candidates.append((dist, track_id, det_idx))
        candidates.sort(key=lambda item: item[0])

        assignment: Dict[int, Centroid] = {}
        used_tracks: set[int] = set()
        used_dets: set[int] = set()
        for _dist, track_id, det_idx in candidates:
            if track_id in used_tracks or det_idx in used_dets:
                continue
            centroid = centroids[det_idx]
            self._tracks[track_id] = centroid
            self._disappeared[track_id] = 0
            assignment[track_id] = centroid
            used_tracks.add(track_id)
            used_dets.add(det_idx)

        # Unmatched existing tracks: age them, dropping any that exceed the limit.
        for track_id in track_ids:
            if track_id not in used_tracks:
                self._disappeared[track_id] += 1
                if self._disappeared[track_id] > self.max_disappeared:
                    self._deregister(track_id)

        # Unmatched detections: register as brand-new tracks.
        for det_idx, centroid in enumerate(centroids):
            if det_idx not in used_dets:
                assignment[self._register(centroid)] = centroid

        return assignment


def displacement_to_kmh(
    distance_px: float,
    meters_per_pixel: float,
    fps: float,
) -> float:
    """Convert a per-frame pixel displacement to km/h.

    ``distance_px`` is how far a centroid moved between two consecutive frames.
    Multiplying by ``meters_per_pixel`` yields metres travelled in one frame
    interval; multiplying by ``fps`` converts per-frame to per-second (m/s); and
    multiplying by 3.6 converts m/s to km/h.
    """
    meters_per_frame = distance_px * meters_per_pixel
    meters_per_second = meters_per_frame * fps
    return meters_per_second * 3.6


class LaneSpeedEstimator:
    """Per-lane cross-frame tracker + average-speed estimator.

    Feed it the detections for one lane, one frame at a time, via ``update``.
    It tracks vehicles across frames and returns the per-lane average speed in
    km/h, bounded to ``[0, max_speed_kmh]``. Speed for a vehicle is only counted
    when that vehicle was tracked in the immediately-preceding frame as well, so
    a single isolated frame yields ``0.0`` (Requirement 3.3).

    Args:
        config: Effective detector config providing ``meters_per_pixel``,
            ``fps``, and ``max_speed_kmh``. Defaults to the module config.
        tracker: Optional pre-built ``CentroidTracker`` (mainly for tests).
    """

    def __init__(
        self,
        config: Optional[DetectorConfig] = None,
        *,
        tracker: Optional[CentroidTracker] = None,
    ) -> None:
        self.config = config or default_config
        self._tracker = tracker or CentroidTracker()
        # Centroids of tracks observed in the previous frame, by track id.
        self._prev_centroids: Dict[int, Centroid] = {}
        # Average speed (km/h) computed on the most recent update.
        self._last_avg_speed: float = 0.0

    @property
    def last_avg_speed(self) -> float:
        """The per-lane average speed (km/h) from the most recent ``update``."""
        return self._last_avg_speed

    def _clamp_speed(self, value: float) -> float:
        """Bound a speed value to ``[0, max_speed_kmh]`` (Requirement 3.4)."""
        if not math.isfinite(value) or value <= 0.0:
            return 0.0
        max_speed = self.config.max_speed_kmh
        if value > max_speed:
            return float(max_speed)
        return float(value)

    def update(self, detections: Sequence[Dict[str, Any]]) -> float:
        """Process one frame's detections and return the lane average speed.

        Args:
            detections: Detection dicts ``{class_name, bbox: [x,y,w,h], ...}`` as
                produced by ``app.detector.Detector.detect`` for one lane/frame.

        Returns:
            The per-lane average speed in km/h, bounded to ``[0, max_speed_kmh]``.
            Returns ``0.0`` when no vehicle is tracked across two or more
            consecutive frames (Requirement 3.3).
        """
        centroids: List[Centroid] = []
        for det in detections:
            bbox = det.get("bbox") if isinstance(det, dict) else None
            if bbox is None or len(bbox) < 4:
                continue
            centroids.append(bbox_centroid(bbox))

        assignment = self._tracker.update(centroids)

        # A vehicle contributes a speed sample only if it was also present in
        # the previous frame (tracked across two consecutive frames -> R3.2).
        speeds: List[float] = []
        for track_id, centroid in assignment.items():
            prev = self._prev_centroids.get(track_id)
            if prev is None:
                continue
            dist_px = _distance(prev, centroid)
            kmh = displacement_to_kmh(
                dist_px, self.config.meters_per_pixel, self.config.fps
            )
            speeds.append(self._clamp_speed(kmh))

        # Remember this frame's positions for the next update.
        self._prev_centroids = dict(assignment)

        if not speeds:
            # Nothing tracked across consecutive frames (Requirement 3.3).
            self._last_avg_speed = 0.0
            return 0.0

        avg = sum(speeds) / len(speeds)
        self._last_avg_speed = self._clamp_speed(avg)
        return self._last_avg_speed

    def reset(self) -> None:
        """Clear all tracking state (e.g. when a clip loops or a lane resets)."""
        self._tracker = CentroidTracker(
            max_match_distance=self._tracker.max_match_distance,
            max_disappeared=self._tracker.max_disappeared,
        )
        self._prev_centroids = {}
        self._last_avg_speed = 0.0


def estimate_lane_speed(
    frames: Sequence[Sequence[Dict[str, Any]]],
    config: Optional[DetectorConfig] = None,
) -> float:
    """Convenience helper: average speed over a whole sequence of frames.

    Runs a fresh ``LaneSpeedEstimator`` across ``frames`` (each a list of
    detections for one frame) and returns the average speed reported on the
    **final** frame. Useful for batch/offline computation and tests.
    """
    estimator = LaneSpeedEstimator(config=config)
    result = 0.0
    for frame_detections in frames:
        result = estimator.update(frame_detections)
    return result
