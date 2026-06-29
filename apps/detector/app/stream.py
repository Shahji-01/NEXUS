"""WebSocket ``/stream`` push-channel logic for the detector service.

This module holds the reusable loop logic behind the FastAPI ``WS /stream``
endpoint so it can be unit-tested without a real socket. The endpoint pushes a
``DetectionFrame`` message as each clip frame is processed (Requirements 2.1,
8.1):

    { "type": "detection_frame",
      "lane_id": <system lane id 0..3>,
      "result": <Detection_Result | null>,
      "error":  <per-lane error | null> }

The core is :func:`iter_detection_frames`, an ``async`` generator that sweeps the
configured lanes, processes one frame per lane via the
:class:`app.pipeline.DetectionPipeline`, and yields the message dicts. Heavy work
is guarded: :meth:`DetectionPipeline.process_lane` already converts per-lane
failures into error objects rather than raising, and this module additionally
catches any unexpected error so a single bad lane (or an unavailable
pipeline/model) results in a per-lane *error frame* rather than tearing down the
socket (Requirements 1.5, 2.5, 11.4).

The generator paces itself with ``asyncio.sleep`` between messages so the loop
never spins hot; the cadence is derived from the configured clip FPS and capped
to a sensible overall rate. For tests, the iteration count and the sleeper are
injectable, so the message stream can be exercised deterministically without a
real socket, real clips, or a real model.

Requirements:
  - 2.1: push per-lane detection results as frames are processed.
  - 8.1: the detector pushes the latest per-lane result as each clip frame is
    processed (the primary low-latency channel).
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional, Protocol

from app.config import DetectorConfig
from app.config import config as default_config

# The WS message type discriminator (design: DetectionFrame).
MESSAGE_TYPE = "detection_frame"

# Overall push cadence is capped so the loop never exceeds a sensible rate even
# when the configured clip FPS is high. With four lanes a 20 msg/s cap keeps the
# per-lane refresh comfortably aligned with the 2s broadcast tick downstream.
MAX_STREAM_FPS = 20.0
MIN_STREAM_FPS = 1.0


class _LanePipeline(Protocol):
    """Structural type for the bits of the pipeline this module relies on."""

    @property
    def lane_ids(self) -> List[int]: ...

    def process_lane(
        self, lane_id: int
    ) -> "tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]": ...


# Type alias for an awaitable sleeper (``asyncio.sleep`` by default; injectable
# in tests to avoid real delays).
Sleeper = Callable[[float], Awaitable[None]]


def default_frame_interval(config: Optional[DetectorConfig] = None) -> float:
    """Seconds to wait between pushed messages, derived from the clip FPS.

    The cadence is clamped to ``[MIN_STREAM_FPS, MAX_STREAM_FPS]`` so a very high
    or zero configured FPS still yields a sane, non-hot loop.
    """
    cfg = config or default_config
    fps = cfg.fps if cfg.fps and cfg.fps > 0 else MAX_STREAM_FPS
    fps = max(MIN_STREAM_FPS, min(fps, MAX_STREAM_FPS))
    return 1.0 / fps


def build_detection_frame(
    lane_id: int,
    result: Optional[Dict[str, Any]],
    error: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Assemble a single ``DetectionFrame`` push message (design contract)."""
    return {
        "type": MESSAGE_TYPE,
        "lane_id": lane_id,
        "result": result,
        "error": error,
    }


def process_lane_frame(pipeline: _LanePipeline, lane_id: int) -> Dict[str, Any]:
    """Process one lane and wrap the outcome in a ``DetectionFrame``.

    :meth:`DetectionPipeline.process_lane` is designed not to raise, but this
    function still guards against an unexpected failure (e.g. a misbehaving
    injected pipeline) so the stream emits a per-lane error frame instead of
    crashing the socket (Requirements 1.5, 2.5, 11.4).
    """
    try:
        result, error = pipeline.process_lane(lane_id)
    except Exception as exc:  # defensive: keep the socket alive on any failure
        return build_detection_frame(
            lane_id,
            None,
            {
                "lane_id": lane_id,
                "code": "STREAM_PROCESS_FAILED",
                "message": f"failed to process lane {lane_id}: {exc}",
            },
        )
    return build_detection_frame(lane_id, result, error)


def _resolve_lane_ids(pipeline: _LanePipeline, lane_ids: Optional[List[int]]) -> List[int]:
    """Resolve the lane ids to sweep, tolerating a misbehaving pipeline."""
    if lane_ids is not None:
        return list(lane_ids)
    try:
        return list(pipeline.lane_ids)
    except Exception:
        return []


async def iter_detection_frames(
    pipeline: _LanePipeline,
    *,
    lane_ids: Optional[List[int]] = None,
    iterations: Optional[int] = None,
    frame_interval: Optional[float] = None,
    sleeper: Sleeper = asyncio.sleep,
) -> AsyncIterator[Dict[str, Any]]:
    """Yield ``DetectionFrame`` messages, one per lane per sweep.

    Sweeps ``lane_ids`` (default: the pipeline's configured lanes) repeatedly,
    yielding one message per lane as its frame is processed and pausing
    ``frame_interval`` seconds between messages to pace the loop (Requirements
    2.1, 8.1).

    Args:
        pipeline: The detection pipeline (anything exposing ``lane_ids`` and
            ``process_lane``).
        lane_ids: Optional explicit lane id list; defaults to ``pipeline.lane_ids``.
        iterations: Number of full lane sweeps to perform. ``None`` (default)
            loops forever — used by the live WebSocket endpoint. A finite value
            bounds the generator for unit tests.
        frame_interval: Seconds between messages; defaults to
            :func:`default_frame_interval`. Set to ``0`` to disable pacing
            (tests).
        sleeper: Awaitable used for pacing; injectable for tests so no real time
            passes.

    Yields:
        ``DetectionFrame`` dicts of the form
        ``{type, lane_id, result, error}``.
    """
    resolved_lanes = _resolve_lane_ids(pipeline, lane_ids)
    interval = default_frame_interval() if frame_interval is None else frame_interval

    swept = 0
    while iterations is None or swept < iterations:
        for lane_id in resolved_lanes:
            yield process_lane_frame(pipeline, lane_id)
            if interval and interval > 0:
                await sleeper(interval)
        swept += 1
        # No lanes configured: avoid a hot empty loop when running unbounded.
        if not resolved_lanes and iterations is None:
            if interval and interval > 0:
                await sleeper(interval)
            else:
                await sleeper(default_frame_interval())
