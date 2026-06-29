"""FastAPI application for the NEXUS detector service.

Exposes the effective configuration plus the detection HTTP endpoints the Node
API consumes:

  * ``GET /config``                 — effective config incl. the Lane_Mapping.
  * ``GET /health``                 — service status + per-lane health.
  * ``GET /detections``             — latest per-lane ``Detection_Result`` for
    all lanes (pull fallback for the WS push channel).
  * ``GET /detections/{laneId}``    — latest result for a single lane.
  * ``GET /lanes/{laneId}/frame``   — latest annotated overlay JPEG.
  * ``GET /lanes/{laneId}/mjpeg``   — annotated overlay MJPEG stream.
  * ``WS  /stream``                 — push ``DetectionFrame`` messages.

Runtime architecture
--------------------
When the service is actually serving (gated by the ``DETECTOR_WORKER`` env var),
a single background :class:`app.worker.DetectionWorker` thread owns all
``VideoCapture`` reads and YOLO inference and publishes the latest per-lane
result / error / annotated JPEG to an in-memory cache. Every endpoint then
serves from that cache with cheap, non-blocking reads. This is required because
OpenCV's FFmpeg backend is not safe to read concurrently and synchronous
inference would otherwise block the asyncio event loop.

When no worker is active (the test suite), the endpoints fall back to driving the
:class:`app.pipeline.DetectionPipeline` directly per request, preserving the
original behavior.

Requirements:
  - 2.1 / 2.5: per-lane detection results; unprocessable frames report a
    lane-identifying error.
  - 2.6: runs as a server-side process separate from the browser.
  - 8.1 / 8.2: ``WS /stream`` pushes per-lane results as frames are processed;
    GET /detections returns the latest per-lane result for all lanes.
  - 9.1 / 9.2 / 9.4: annotated overlay frame + MJPEG endpoints.
  - 10.5 / 1.1 / 1.3: GET /config exposes the Lane_Mapping and lane layout.
  - 11.1 / 11.3 / 11.4: GET /health liveness/readiness; one lane error does not
    suppress the others.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import AsyncIterator, Iterator, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse

from app.config import config
from app.overlay import MJPEG_BOUNDARY, mjpeg_chunk, placeholder_jpeg
from app.pipeline import get_pipeline
from app.stream import default_frame_interval, iter_detection_frames
from app.worker import get_worker, start_worker

app = FastAPI(
    title="NEXUS Detector Service",
    version="0.1.0",
    summary="Computer-vision traffic detection microservice for the NEXUS AI Junction Optimizer.",
)


@app.on_event("startup")
def _maybe_start_worker() -> None:
    """Start the background detection worker when serving (opt-in).

    Gated on ``DETECTOR_WORKER=1`` so the test suite (which drives the pipeline
    directly and never sets the flag) is unaffected, while the production launch
    enables the single-owner worker that keeps the event loop responsive and
    avoids concurrent ``VideoCapture`` access.
    """
    if os.environ.get("DETECTOR_WORKER") == "1":
        start_worker(get_pipeline())


@app.get("/config")
def get_config() -> dict:
    """Return the effective detector configuration, including the lane mapping.

    The Node `DetectionClient` reads this on startup to translate detector lane
    identifiers to system lane ids 0..3 (Requirement 10.5).
    """
    return config.as_dict()


@app.get("/health")
def get_health() -> dict:
    """Liveness/readiness probe: overall status plus per-lane health.

    Reports ``config_error`` when all configured clips fail to open and ``ok``
    otherwise, while still listing each lane's error so a single unavailable lane
    is visible without failing the others (Requirements 1.6, 11.1, 11.3, 11.4).
    """
    worker = get_worker()
    if worker is not None:
        return worker.health()
    return get_pipeline().health()


@app.get("/detections")
def get_detections() -> dict:
    """Return the latest per-lane ``Detection_Result`` for every lane.

    A single bad clip/lane yields a per-lane error with ``result: null`` while
    the other lanes carry their results; the overall ``service_status`` is
    ``config_error`` only when every lane failed (Requirements 2.1, 2.5, 8.2,
    11.4, 1.6).
    """
    worker = get_worker()
    if worker is not None:
        return worker.detections_payload()
    return get_pipeline().detections_payload()


@app.get("/detections/{lane_id}")
def get_lane_detection(lane_id: int) -> dict:
    """Return the latest result (or per-lane error) for a single lane.

    Responds with ``404`` when the lane id is not configured; otherwise a
    ``{lane_id, result, error}`` entry where an unopenable clip / unprocessable
    frame yields ``result: null`` and a lane-identifying error (Requirements 2.5,
    11.4).
    """
    worker = get_worker()
    entry = worker.lane_payload(lane_id) if worker is not None else get_pipeline().lane_payload(lane_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"lane {lane_id} is not configured")
    return entry


# MJPEG default pacing: a modest refresh rate so the overlay stream never spins
# hot. Aligned comfortably below the configured clip FPS / the WS push cadence.
_MJPEG_DEFAULT_DELAY = 0.1  # seconds between pushed overlay frames (~10 fps)


def _lane_configured(lane_id: int) -> bool:
    """Whether ``lane_id`` is a configured lane (worker or pipeline view)."""
    worker = get_worker()
    if worker is not None:
        return lane_id in worker.lane_ids
    return lane_id in get_pipeline().lane_ids


@app.get("/lanes/{lane_id}/frame")
def get_lane_frame(lane_id: int) -> Response:
    """Return the latest annotated overlay JPEG for a single lane.

    Boxes + class labels are baked into the returned frame (Requirements 9.1,
    9.2). Responds with ``404`` when the lane id is not configured. When the
    clip/OpenCV/model are unavailable a valid placeholder JPEG is returned so the
    endpoint always serves ``image/jpeg`` (graceful degradation).
    """
    worker = get_worker()
    if worker is not None:
        jpeg = worker.frame_jpeg(lane_id)
    else:
        jpeg = get_pipeline().annotated_frame_bytes(lane_id)
    if jpeg is None:
        raise HTTPException(status_code=404, detail=f"lane {lane_id} is not configured")
    return Response(content=jpeg, media_type="image/jpeg")


def _mjpeg_generator(lane_id: int, max_frames: Optional[int], delay: float) -> Iterator[bytes]:
    """Sync MJPEG generator (no-worker path): render per-frame from the pipeline."""
    pipeline = get_pipeline()
    count = 0
    while max_frames is None or count < max_frames:
        jpeg = pipeline.annotated_frame_bytes(lane_id)
        if jpeg is None:
            break
        yield mjpeg_chunk(jpeg, MJPEG_BOUNDARY)
        count += 1
        if delay and delay > 0:
            time.sleep(delay)


async def _mjpeg_worker_generator(
    lane_id: int, max_frames: Optional[int], delay: float
) -> AsyncIterator[bytes]:
    """Async MJPEG generator (worker path): serve cached overlay JPEGs.

    Reads the worker's latest cached annotated JPEG for the lane and paces with
    ``asyncio.sleep`` so the event loop stays responsive and no ``VideoCapture``
    is touched in the request handler.
    """
    worker = get_worker()
    count = 0
    while max_frames is None or count < max_frames:
        jpeg = (worker.frame_jpeg(lane_id) if worker is not None else None) or placeholder_jpeg()
        yield mjpeg_chunk(jpeg, MJPEG_BOUNDARY)
        count += 1
        if delay and delay > 0:
            await asyncio.sleep(delay)


@app.get("/lanes/{lane_id}/mjpeg")
def get_lane_mjpeg(lane_id: int, frames: Optional[int] = None) -> StreamingResponse:
    """Stream the annotated overlay for a lane as MJPEG (Requirements 9.1, 9.4).

    Returns a ``multipart/x-mixed-replace`` response whose parts are the lane's
    annotated overlay frames. Responds with ``404`` when the lane id is not
    configured. The optional ``frames`` query bounds the stream to that many
    frames (otherwise it streams continuously). When the worker is active the
    frames come from its cache (non-blocking); otherwise they are rendered
    per-frame from the pipeline.
    """
    if not _lane_configured(lane_id):
        raise HTTPException(status_code=404, detail=f"lane {lane_id} is not configured")

    media_type = f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}"
    if get_worker() is not None:
        return StreamingResponse(
            _mjpeg_worker_generator(lane_id, max_frames=frames, delay=_MJPEG_DEFAULT_DELAY),
            media_type=media_type,
        )
    return StreamingResponse(
        _mjpeg_generator(lane_id, max_frames=frames, delay=_MJPEG_DEFAULT_DELAY),
        media_type=media_type,
    )


@app.websocket("/stream")
async def stream_detections(websocket: WebSocket) -> None:
    """Push ``DetectionFrame`` messages for each lane.

    When the worker is active, this pushes the worker's cached per-lane results
    on a paced loop (no inference in the handler). When no worker is active
    (tests), it falls back to driving the pipeline directly via
    :func:`app.stream.iter_detection_frames`. A single bad lane yields a per-lane
    error frame rather than crashing the socket (Requirements 1.5, 2.5, 11.4);
    a client disconnect stops the loop cleanly.
    """
    await websocket.accept()
    worker = get_worker()
    try:
        if worker is not None:
            lane_ids = worker.lane_ids
            interval = default_frame_interval()
            while True:
                for lane_id in lane_ids:
                    await websocket.send_json(worker.stream_frame(lane_id))
                    if interval and interval > 0:
                        await asyncio.sleep(interval)
        else:
            async for frame in iter_detection_frames(get_pipeline()):
                await websocket.send_json(frame)
    except WebSocketDisconnect:
        return
    except (RuntimeError, ConnectionError):
        # Socket closed/broke mid-send. Stop the loop without surfacing an error.
        return


def run() -> None:
    """Console-script entrypoint: start uvicorn bound to the configured host/port."""
    import uvicorn

    uvicorn.run("app.main:app", host=config.host, port=config.port, reload=False)


if __name__ == "__main__":
    run()
