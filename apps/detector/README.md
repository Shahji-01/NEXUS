# NEXUS Detector Service (`apps/detector`)

Python computer-vision microservice (YOLO + OpenCV) that powers the **video**
data source for the NEXUS AI Junction Optimizer. It reads four bundled, looping
demo clips (one per lane) and produces per-lane detection results that the Node
API maps into the canonical `LaneData` shape.

This is a separate OS process from the Node API and the browser (Requirement 2.6).
The Node API reaches it via `DETECTOR_URL` (default `http://127.0.0.1:8099`).

## Layout

```
apps/detector/
  app/
    config.py     # effective config: lane mapping, thresholds, meters_per_pixel, FPS, port
    main.py       # FastAPI app + GET /config
  clips/          # lane_{0..3}.mp4 looping demo clips (not committed yet)
  tests/          # pytest suite
  pyproject.toml
  requirements.txt
```

## Lane mapping

Detector camera identifiers translate to system lane ids `0..3`:

| Detector id | Lane id | Direction |
| ----------- | ------- | --------- |
| `cam_north` | 0       | North     |
| `cam_south` | 1       | South     |
| `cam_east`  | 2       | East      |
| `cam_west`  | 3       | West      |

## Configuration

All values resolve from environment variables with sane defaults (see
`app/config.py`):

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `DETECTOR_URL` | `http://127.0.0.1:8099` | Base URL / host+port binding |
| `DETECTOR_HOST` | from URL | Bind host override |
| `DETECTOR_PORT` | `8099` | Bind port override |
| `EMERGENCY_CONFIDENCE_MIN` | `0.60` | Min confidence for an emergency-vehicle report |
| `DETECTION_CONFIDENCE_MIN` | `0.35` | Min confidence to count a detection |
| `METERS_PER_PIXEL` | `0.05` | Spatial calibration for speed estimation |
| `DETECTOR_FPS` | `25.0` | Clip frame rate used for speed estimation |
| `CLIPS_DIR` | `clips` | Folder holding `lane_{0..3}.mp4` |

## Setup

```bash
cd apps/detector
python -m venv .venv
. .venv/Scripts/activate   # Windows; use `source .venv/bin/activate` on *nix
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8099
# or
python -m app.main
```

## Test

```bash
pytest
```

The config tests run with only the standard library; the FastAPI endpoint test
is skipped automatically until `fastapi`/`httpx` are installed.

## Endpoints

| Method | Path | Status | Purpose |
| ------ | ---- | ------ | ------- |
| `GET`  | `/config` | implemented | Effective config incl. `lane_mapping` |
| `GET`  | `/health` | implemented | Service status + per-lane health (`config_error` when all clips fail) |
| `GET`  | `/detections` | implemented | Latest per-lane `Detection_Result` for all lanes |
| `GET`  | `/detections/{laneId}` | implemented | Latest result (or per-lane error) for one lane |

The `/stream` (WS push) and the MJPEG/frame overlay endpoints are added in later
tasks.
