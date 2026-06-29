"""Background detection worker — single owner of video reading + inference.

The detection endpoints (``/detections``, ``/detections/{id}``, ``/health``,
the ``WS /stream`` push channel, and the ``/lanes/{id}/frame`` + ``/mjpeg``
overlay endpoints) must NOT read from a ``cv2.VideoCapture`` or run YOLO
inference directly inside their request/coroutine handlers:

  * OpenCV's FFmpeg backend is not safe to read from concurrently — multiple
    handlers reading the same clip from different threads triggers
    ``Assertion fctx->async_lock failed`` and corrupts decoding.
  * YOLO inference is synchronous and CPU-bound; running it inside the asyncio
    event loop starves every other endpoint (e.g. ``/health`` stalls).

:class:`DetectionWorker` solves both by being the *only* component that touches
the captures and the model. It runs one background thread that processes each
lane sequentially via :meth:`DetectionPipeline.process_lane_full` (one read +
one inference per lane per cycle) and stores the latest per-lane
``Detection_Result`` / error / annotated JPEG in an in-memory cache guarded by a
lock. All endpoints then serve from that cache with cheap, non-blocking reads.

This worker is opt-in: it is only started when the service is actually serving
(gated by the ``DETECTOR_WORKER`` env var in :mod:`app.main`), so the test suite
— which exercises the pipeline directly — is unaffected.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.health import build_detections_payload, build_lane_result_entry
from app.overlay import placeholder_jpeg
from app.pipeline import DetectionPipeline


class DetectionWorker:
    """Owns all video reading + inference on one background thread.

    Args:
        pipeline: The :class:`DetectionPipeline` to drive. The worker is the sole
            caller of its frame-reading/inference methods once started.
        cycle_pause_s: Seconds to sleep between lane processing steps. Keeps the
            loop from spinning hot and yields the GIL between (native) inference
            calls so the HTTP/WS handlers stay responsive.
    """

    def __init__(self, pipeline: DetectionPipeline, *, cycle_pause_s: float = 0.02) -> None:
        self._pipeline = pipeline
        self._cycle_pause_s = cycle_pause_s
        self._lane_ids: List[int] = list(pipeline.lane_ids)

        self._lock = threading.Lock()
        self._results: Dict[int, Dict[str, Any]] = {}
        self._errors: Dict[int, Dict[str, Any]] = {}
        self._jpegs: Dict[int, bytes] = {}
        self._opened: Dict[int, bool] = {}

        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._started_at = datetime.now(timezone.utc)

        # Seed an initial health view so endpoints work before the first cycle.
        try:
            initial = pipeline.health()
            for lane_id in self._lane_ids:
                lane = initial.get("lanes", {}).get(str(lane_id), {})
                self._opened[lane_id] = bool(lane.get("opened", False))
        except Exception:
            for lane_id in self._lane_ids:
                self._opened[lane_id] = False

    # --- lifecycle -------------------------------------------------------

    def start(self) -> None:
        """Start the background processing thread (idempotent)."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="detection-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Signal the background thread to stop (best-effort)."""
        self._stop.set()

    @property
    def lane_ids(self) -> List[int]:
        return list(self._lane_ids)

    # --- background loop -------------------------------------------------

    def _loop(self) -> None:
        while not self._stop.is_set():
            for lane_id in self._lane_ids:
                if self._stop.is_set():
                    break
                try:
                    result, error, jpeg = self._pipeline.process_lane_full(lane_id)
                except Exception as exc:  # pragma: no cover - defensive
                    result, error, jpeg = (
                        None,
                        {
                            "code": "WORKER_PROCESS_FAILED",
                            "message": f"worker failed for lane {lane_id}: {exc}",
                            "lane_id": lane_id,
                        },
                        placeholder_jpeg(),
                    )
                with self._lock:
                    if error is not None:
                        self._errors[lane_id] = error
                        self._results.pop(lane_id, None)
                        self._opened[lane_id] = False
                    else:
                        self._results[lane_id] = result  # type: ignore[assignment]
                        self._errors.pop(lane_id, None)
                        self._opened[lane_id] = True
                    if jpeg:
                        self._jpegs[lane_id] = jpeg
                # Yield between lanes so request/WS handlers stay responsive.
                if self._cycle_pause_s > 0:
                    time.sleep(self._cycle_pause_s)

    # --- cached snapshots (cheap, non-blocking reads) --------------------

    def _snapshot(self) -> tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]], Dict[int, bool]]:
        with self._lock:
            return dict(self._results), dict(self._errors), dict(self._opened)

    def detections_payload(self) -> Dict[str, Any]:
        """``GET /detections`` payload built from the cache (no capture reads)."""
        results, errors, opened = self._snapshot()
        # Derive system status from clip openability, matching the direct path:
        # config_error only when every configured lane is unavailable.
        if self._lane_ids and all(not opened.get(l, False) for l in self._lane_ids):
            status = "config_error"
        else:
            status = "ok"
        payload = build_detections_payload(results=results, errors=errors, lane_ids=self._lane_ids)
        payload["service_status"] = status
        return payload

    def lane_payload(self, lane_id: int) -> Optional[Dict[str, Any]]:
        """``GET /detections/{laneId}`` entry from the cache, or ``None`` if unknown."""
        if lane_id not in self._lane_ids:
            return None
        with self._lock:
            result = self._results.get(lane_id)
            error = self._errors.get(lane_id)
        return build_lane_result_entry(lane_id, result=result, error=error)

    def health(self) -> Dict[str, Any]:
        """``GET /health`` payload from the cache."""
        results, errors, opened = self._snapshot()
        failed = sorted(l for l in self._lane_ids if not opened.get(l, False))
        status = "config_error" if (self._lane_ids and len(failed) == len(self._lane_ids)) else "ok"
        return {
            "status": status,
            "service_status": status,
            "failed_lanes": failed,
            "lanes": {
                str(l): {"opened": opened.get(l, False), "error": errors.get(l)}
                for l in self._lane_ids
            },
        }

    def stream_frame(self, lane_id: int) -> Dict[str, Any]:
        """Build a ``DetectionFrame`` push message for a lane from the cache."""
        with self._lock:
            result = self._results.get(lane_id)
            error = self._errors.get(lane_id)
        return {"type": "detection_frame", "lane_id": lane_id, "result": result, "error": error}

    def frame_jpeg(self, lane_id: int) -> Optional[bytes]:
        """Latest annotated JPEG for a lane, or ``None`` if the lane is unknown.

        Returns the placeholder JPEG for a known lane that has not produced a
        frame yet, so the overlay endpoints always serve a valid image.
        """
        if lane_id not in self._lane_ids:
            return None
        with self._lock:
            return self._jpegs.get(lane_id) or placeholder_jpeg()


# Module-level singleton, set when the service starts serving (see app.main).
_worker: Optional[DetectionWorker] = None


def get_worker() -> Optional[DetectionWorker]:
    """Return the active worker, or ``None`` when running without one (tests)."""
    return _worker


def start_worker(pipeline: DetectionPipeline) -> DetectionWorker:
    """Create, start, and register the process-wide detection worker."""
    global _worker
    if _worker is None:
        _worker = DetectionWorker(pipeline)
        _worker.start()
    return _worker


def set_worker(worker: Optional[DetectionWorker]) -> None:
    """Override/reset the process-wide worker (mainly for tests/DI)."""
    global _worker
    _worker = worker
