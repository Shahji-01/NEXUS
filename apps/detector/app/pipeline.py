"""Per-lane detection pipeline that assembles the `Detection_Result` contract.

This module wires together the existing dependency-light pipeline modules into a
single per-lane processing pipeline used by the detection HTTP endpoints
(``GET /detections``, ``GET /detections/{laneId}``, ``GET /health``):

  * :class:`app.video_loop.VideoLoop` — reads the next frame for a lane's clip,
    looping at EOF (Requirement 1.2). Construction never raises; an unopenable
    clip is surfaced as a lane-identifying error state.
  * :class:`app.detector.Detector` — runs YOLO inference and maps detections to
    the Vehicle_Class set; ``aggregate_detections`` folds them into per-class
    counts plus an exact ``vehicle_count`` (Requirements 2.1–2.4).
  * :mod:`app.density` — derives a bounded density and the congestion level
    (Requirement 4).
  * :class:`app.tracker.LaneSpeedEstimator` — cross-frame average speed per lane,
    bounded to ``[0, 200]`` km/h (Requirement 3).
  * :func:`app.emergency.recognize_emergency` — emergency-vehicle field
    (Requirement 5).
  * :mod:`app.health` — combines per-lane results/errors into the response
    payloads and computes the system-wide status so one bad lane never fails the
    batch (Requirements 1.4, 1.5, 1.6, 2.5, 11.4).

The heavy model load stays lazy/guarded inside :class:`Detector`, so this module
imports cleanly without ``ultralytics``/``cv2`` installed. When the model or a
clip is unavailable the affected lane degrades to a per-lane error object rather
than raising, and the endpoints still return a valid payload.

Per-lane state (a :class:`VideoLoop` plus a :class:`LaneSpeedEstimator`) is
created once per pipeline instance and reused across requests so tracking is
continuous frame-to-frame.

Requirements:
  - 2.1: detection results expose detected vehicles per lane.
  - 2.5: an unprocessable frame yields a lane-identifying error.
  - 8.2: ``GET /detections`` returns the latest per-lane result for all lanes.
  - 11.1 / 11.3: ``GET /health`` reports service liveness/readiness.
  - 11.4: a single lane error does not suppress the other lanes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple

from app.config import LANE_DIRECTIONS, DetectorConfig
from app.config import config as default_config
from app.density import congestion_level, density_from_detections
from app.detector import Detector, aggregate_detections
from app.emergency import recognize_emergency
from app.health import (
    build_detections_payload,
    build_lane_result_entry,
    compute_health,
    frame_error,
    normalize_lane_error,
)
from app.tracker import LaneSpeedEstimator
from app.video_loop import VideoLoop


def _reverse_lane_mapping(lane_mapping: Mapping[str, int]) -> Dict[int, str]:
    """Build ``system lane id -> detector identifier`` from the Lane_Mapping.

    The configured mapping is ``detector_id -> system_lane_id`` (Requirement
    10.5). The detection contract reports the originating ``detector_lane`` for
    each system lane, so we invert it. If two detector ids ever collided onto one
    lane (they should not), the first by sorted detector id wins for determinism.
    """
    reverse: Dict[int, str] = {}
    for detector_id in sorted(lane_mapping):
        system_lane = lane_mapping[detector_id]
        reverse.setdefault(system_lane, detector_id)
    return reverse


def _frame_area(frame: Any) -> Optional[float]:
    """Best-effort ``height * width`` of a frame, or ``None`` if unknown.

    Works for OpenCV/numpy frames (``frame.shape == (h, w, c)``) without
    importing numpy; returns ``None`` for frames that do not expose a usable
    shape so the density heuristic falls back to its count-based component.
    """
    shape = getattr(frame, "shape", None)
    if shape is None:
        return None
    try:
        height = float(shape[0])
        width = float(shape[1])
    except (TypeError, IndexError, ValueError):
        return None
    if height <= 0 or width <= 0:
        return None
    return height * width


@dataclass
class LaneState:
    """Per-lane mutable state held for the lifetime of the pipeline.

    Attributes:
        lane_id: System lane id (0..3) this state serves.
        detector_lane: Originating detector identifier (e.g. ``cam_north``).
        loop: The lane's looping clip reader.
        speed_estimator: Cross-frame tracker/speed estimator for the lane.
    """

    lane_id: int
    detector_lane: Optional[str]
    loop: VideoLoop
    speed_estimator: LaneSpeedEstimator


class DetectionPipeline:
    """Assembles per-lane ``Detection_Result`` objects and response payloads.

    A single instance owns the per-lane :class:`VideoLoop` and
    :class:`LaneSpeedEstimator` plus one shared :class:`Detector`. It is created
    once (see :func:`get_pipeline`) and reused across requests.

    Args:
        config: Effective detector configuration; defaults to the module config.
        detector: Optional pre-built detector (mainly for tests / DI). Any object
            exposing ``detect(frame) -> list[dict]`` works.
        video_loops: Optional mapping ``lane_id -> VideoLoop`` to inject (tests).
            Lanes absent from the mapping get a real clip-backed loop.
    """

    def __init__(
        self,
        config: Optional[DetectorConfig] = None,
        *,
        detector: Optional[Any] = None,
        video_loops: Optional[Mapping[int, VideoLoop]] = None,
    ) -> None:
        self._config = config or default_config
        self._detector = detector if detector is not None else Detector(config=self._config)
        self._lane_ids: List[int] = list(self._config.lane_ids)
        reverse = _reverse_lane_mapping(self._config.lane_mapping)

        self._lane_states: Dict[int, LaneState] = {}
        for lane_id in self._lane_ids:
            if video_loops is not None and lane_id in video_loops:
                loop = video_loops[lane_id]
            else:
                loop = VideoLoop(lane_id, self._config.clip_path(lane_id))
            self._lane_states[lane_id] = LaneState(
                lane_id=lane_id,
                detector_lane=reverse.get(lane_id),
                loop=loop,
                speed_estimator=LaneSpeedEstimator(config=self._config),
            )

    @property
    def lane_ids(self) -> List[int]:
        """The configured system lane ids served by this pipeline."""
        return list(self._lane_ids)

    # --- single-lane processing ------------------------------------------

    def process_lane(self, lane_id: int) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """Process one lane, returning ``(result, error)`` with exactly one set.

        Reads the next frame, runs detection/aggregation/density/speed/emergency,
        and assembles a ``Detection_Result`` dict. Any failure (unopenable clip,
        no frame, model unavailable, inference error) is converted into a
        lane-identifying error object instead of raising, so a single bad lane
        never fails the batch (Requirements 1.4, 2.5, 11.4).

        Args:
            lane_id: The system lane id to process.

        Returns:
            ``(result, None)`` on success or ``(None, error)`` on failure.
        """
        state = self._lane_states.get(lane_id)
        if state is None:
            return None, frame_error(lane_id, f"lane {lane_id} is not configured")

        loop = state.loop

        # 1) Clip openability — surface the lane-identifying open error (R1.4).
        if not loop.opened:
            error = normalize_lane_error(loop, lane_id)
            return None, (error or frame_error(lane_id, "clip is not open"))

        # 2) Read the next frame (loops at EOF). None means the clip is unusable.
        try:
            frame = loop.read_frame()
        except Exception as exc:  # defensive: read_frame shouldn't raise
            return None, frame_error(lane_id, f"failed to read frame: {exc}")
        if frame is None:
            error = normalize_lane_error(loop, lane_id)
            return None, (error or frame_error(lane_id, "no frame available"))

        # 3) Detection — the heavy model loads lazily here; degrade on failure.
        try:
            detections = self._detector.detect(frame)
        except Exception as exc:
            return None, frame_error(lane_id, f"detection failed: {exc}")

        # 4) Aggregate counts, density/congestion, speed, and emergency.
        try:
            counts = aggregate_detections(detections)
            density = density_from_detections(detections, frame_area=_frame_area(frame))
            congestion = congestion_level(density)
            avg_speed = state.speed_estimator.update(detections)
            emergency = recognize_emergency(detections, self._config)
        except Exception as exc:
            return None, frame_error(lane_id, f"frame processing failed: {exc}")

        result = self._assemble_result(
            state=state,
            counts=counts,
            density=density,
            congestion=congestion,
            avg_speed=avg_speed,
            emergency=emergency,
            frame_id=loop.frames_read,
        )
        return result, None

    def process_lane_full(
        self, lane_id: int
    ) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], bytes]:
        """Process one lane and render its overlay JPEG from the SAME frame.

        Performs a single frame read and a single inference pass, then returns
        ``(result, error, jpeg_bytes)`` — exactly one of ``result``/``error`` is
        set, and ``jpeg_bytes`` is always a valid JPEG (annotated frame when
        possible, otherwise a placeholder). This is the method the background
        :class:`app.worker.DetectionWorker` uses so a lane's detection result and
        its overlay frame stay consistent and the clip is read only once per
        cycle (avoiding concurrent ``VideoCapture`` access).
        """
        from app.overlay import render_annotated_jpeg, placeholder_jpeg

        state = self._lane_states.get(lane_id)
        if state is None:
            return None, frame_error(lane_id, f"lane {lane_id} is not configured"), placeholder_jpeg()

        loop = state.loop
        if not loop.opened:
            error = normalize_lane_error(loop, lane_id)
            return None, (error or frame_error(lane_id, "clip is not open")), placeholder_jpeg()

        try:
            frame = loop.read_frame()
        except Exception as exc:
            return None, frame_error(lane_id, f"failed to read frame: {exc}"), placeholder_jpeg()
        if frame is None:
            error = normalize_lane_error(loop, lane_id)
            return None, (error or frame_error(lane_id, "no frame available")), placeholder_jpeg()

        try:
            detections = self._detector.detect(frame)
        except Exception as exc:
            # Model unavailable — render the bare frame (no overlays) and report
            # the lane error so other lanes are unaffected.
            return None, frame_error(lane_id, f"detection failed: {exc}"), render_annotated_jpeg(frame, [])

        try:
            counts = aggregate_detections(detections)
            density = density_from_detections(detections, frame_area=_frame_area(frame))
            congestion = congestion_level(density)
            avg_speed = state.speed_estimator.update(detections)
            emergency = recognize_emergency(detections, self._config)
        except Exception as exc:
            return None, frame_error(lane_id, f"frame processing failed: {exc}"), render_annotated_jpeg(frame, detections)

        result = self._assemble_result(
            state=state,
            counts=counts,
            density=density,
            congestion=congestion,
            avg_speed=avg_speed,
            emergency=emergency,
            frame_id=loop.frames_read,
        )
        return result, None, render_annotated_jpeg(frame, detections)

    def _assemble_result(
        self,
        *,
        state: LaneState,
        counts: Mapping[str, int],
        density: float,
        congestion: str,
        avg_speed: float,
        emergency: Optional[Dict[str, Any]],
        frame_id: int,
    ) -> Dict[str, Any]:
        """Assemble the per-lane ``Detection_Result`` dict (design contract)."""
        return {
            "detector_lane": state.detector_lane,
            "lane_id": state.lane_id,
            "direction": LANE_DIRECTIONS.get(state.lane_id),
            "vehicle_count": counts["vehicle_count"],
            "cars": counts["cars"],
            "bikes": counts["bikes"],
            "trucks": counts["trucks"],
            "buses": counts["buses"],
            "density": density,
            "avg_speed": avg_speed,
            "congestion_level": congestion,
            "emergency": emergency,
            "frame_id": frame_id,
            "produced_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }

    # --- overlay rendering -----------------------------------------------

    def annotated_frame_bytes(self, lane_id: int) -> Optional[bytes]:
        """Return the latest annotated overlay JPEG for a lane (Requirement 9).

        Reads the next frame for the lane and runs detection to obtain the
        bounding boxes/labels, then renders them onto the frame and encodes to
        JPEG via :func:`app.overlay.render_annotated_jpeg`.

        The rendering degrades gracefully: when the lane's clip is unopenable, no
        frame is available, OpenCV is missing, or the model is unavailable, a
        valid placeholder JPEG is returned instead of raising — so the overlay
        endpoints always serve a valid ``image/jpeg`` payload (Requirements 9.1,
        9.2; placeholder fallback per 9.3).

        Args:
            lane_id: The system lane id whose overlay frame is requested.

        Returns:
            JPEG bytes for a configured lane (annotated frame or placeholder), or
            ``None`` when the lane id is not configured (the endpoint maps this to
            a 404).
        """
        # Imported lazily so this module keeps importing without cv2/numpy.
        from app.overlay import render_annotated_jpeg

        state = self._lane_states.get(lane_id)
        if state is None:
            return None

        frame: Any = None
        detections: List[Dict[str, Any]] = []
        loop = state.loop
        if loop.opened:
            try:
                frame = loop.read_frame()
            except Exception:
                frame = None
            if frame is not None:
                try:
                    detections = self._detector.detect(frame)
                except Exception:
                    # Model/clip unavailable — render the bare frame (or a
                    # placeholder) without detection overlays.
                    detections = []

        return render_annotated_jpeg(frame, detections)

    # --- all-lane processing & payloads ----------------------------------

    def _process_all(self) -> Tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]]]:
        """Process every configured lane, partitioning into results vs errors."""
        results: Dict[int, Dict[str, Any]] = {}
        errors: Dict[int, Dict[str, Any]] = {}
        for lane_id in self._lane_ids:
            result, error = self.process_lane(lane_id)
            if error is not None:
                errors[lane_id] = error
            else:
                assert result is not None  # invariant: exactly one is set
                results[lane_id] = result
        return results, errors

    def _lane_state_loops(self) -> Dict[int, VideoLoop]:
        """Mapping ``lane_id -> VideoLoop`` for system-status computation."""
        return {lane_id: st.loop for lane_id, st in self._lane_states.items()}

    def detections_payload(self) -> Dict[str, Any]:
        """Build the ``GET /detections`` payload for all lanes.

        Combines successful per-lane results and per-lane errors into the
        ``{service_status, lanes}`` contract; the status is derived from clip
        openability so it reports ``config_error`` only when every lane failed
        (Requirements 2.5, 8.2, 11.4, 1.6).
        """
        results, errors = self._process_all()
        return build_detections_payload(
            results=results,
            errors=errors,
            lane_states=self._lane_state_loops(),
            lane_ids=self._lane_ids,
        )

    def lane_payload(self, lane_id: int) -> Optional[Dict[str, Any]]:
        """Build the per-lane entry for ``GET /detections/{laneId}``.

        Returns ``None`` when the lane id is not configured (the endpoint maps
        this to a 404). Otherwise returns a ``{lane_id, result, error}`` entry
        where exactly one of ``result`` / ``error`` is populated (Requirement
        2.5, 11.4).
        """
        if lane_id not in self._lane_states:
            return None
        result, error = self.process_lane(lane_id)
        return build_lane_result_entry(lane_id, result=result, error=error)

    def health(self) -> Dict[str, Any]:
        """Build the ``GET /health`` payload: status + per-lane health.

        Uses :func:`app.health.compute_health` over the per-lane clip openability
        so the overall ``status`` is ``config_error`` when all clips fail to open
        and ``ok`` otherwise, while still listing each lane's error (Requirements
        1.6, 11.1, 11.3, 11.4).
        """
        loops = self._lane_state_loops()
        health = compute_health(loops)
        lane_errors = health["lane_errors"]
        return {
            "status": health["service_status"],
            "service_status": health["service_status"],
            "failed_lanes": health["failed_lanes"],
            "lanes": {
                str(lane_id): {
                    "opened": loops[lane_id].opened,
                    "detector_lane": self._lane_states[lane_id].detector_lane,
                    "error": lane_errors.get(lane_id),
                }
                for lane_id in self._lane_ids
            },
        }


# Module-level singleton, created lazily so importing this module is cheap and
# side-effect free (no clip/model access until first use).
_pipeline: Optional[DetectionPipeline] = None


def get_pipeline() -> DetectionPipeline:
    """Return the process-wide :class:`DetectionPipeline`, creating it once."""
    global _pipeline
    if _pipeline is None:
        _pipeline = DetectionPipeline()
    return _pipeline


def set_pipeline(pipeline: Optional[DetectionPipeline]) -> None:
    """Override (or reset with ``None``) the process-wide pipeline (tests/DI)."""
    global _pipeline
    _pipeline = pipeline
