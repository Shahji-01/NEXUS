# NEXUS — Deployment Guide

Production deployment runs three services plus a database, orchestrated with
Docker Compose:

| Service    | What it is                                              | Port |
|------------|---------------------------------------------------------|------|
| `app`      | Express API **and** the bundled React dashboard + WebSocket | 8080 |
| `detector` | Python CV microservice (YOLO + OpenCV), worker enabled  | 8099 (internal) |
| `db`       | PostgreSQL 16 (persisted in the `nexus-db` volume)      | 5432 (internal) |
| `migrate`  | One-shot Drizzle schema push, then exits                | —    |

The `app` image serves the dashboard, the REST API, and the WebSocket feed on a
single port. It reaches the detector over the internal Compose network at
`http://detector:8099`; the detector is not exposed publicly.

---

## 1. Prerequisites

- Docker + Docker Compose v2
- The four demo clips at `apps/detector/clips/lane_{0..3}.mp4` (mounted into the
  detector; swap in your own without rebuilding). Video mode falls back to the
  simulation if clips are missing.

## 2. Configure

```bash
cp .env.example .env
# Edit .env and set a strong SESSION_SECRET (required).
# Optionally set GEMINI_API_KEY to enable the AI Copilot.
# POSTGRES_* default to postgres/postgres/nexus.
```

Compose builds the container `DATABASE_URL` from the `POSTGRES_*` values (it
points at the `db` service, not localhost), so you do not set `DATABASE_URL` for
Docker. The `PORT`/`DATABASE_URL` lines in `.env` are only used for non-Docker
local development.

## 3. Build & run

```bash
docker compose up --build -d
```

Startup order is handled automatically: `db` (health-checked) → `migrate`
(creates/syncs tables, then exits) → `detector` → `app`.

- Dashboard + API: <http://localhost:8080>
- Health check:    <http://localhost:8080/api/healthz>

Change the host port with `APP_PORT` in `.env` (the container always listens on
8080).

## 4. Operate

```bash
docker compose logs -f app          # tail the API/UI logs
docker compose logs -f detector     # tail the detector logs
docker compose ps                   # service status
docker compose down                 # stop (keeps the db volume)
docker compose down -v              # stop and DELETE the database volume
```

Re-running `docker compose up --build` re-applies the schema via the `migrate`
service (idempotent).

---

## Notes & tuning

- **Switch data source:** the dashboard's Data Source toggle (or
  `POST /api/source/mode` with `{"mode":"video"|"simulation"}`) flips between the
  synthetic simulation and live CV detection. Default is `simulation`.
- **Detector performance:** inference is CPU-bound. Overlay frames are downscaled
  (`overlay_max_width`, default 854) and JPEG-compressed (`overlay_jpeg_quality`,
  default 70); inference runs at `inference_imgsz` (default 480). These are
  configurable via env on the `detector` service (`OVERLAY_MAX_WIDTH`, etc. can be
  added to `app/config.py`'s `load_config` if you want runtime overrides). A GPU
  base image + CUDA torch will dramatically improve throughput.
- **Model weights:** `yolov8n.pt` is fetched during the detector image build and
  baked in — no runtime download.
- **Scaling:** `app` is stateless (all live state is in-process simulation/cache
  + Postgres for history) and can run multiple replicas behind a load balancer;
  use sticky sessions for the WebSocket, or front it with a WS-aware proxy.
- **Security before public exposure:** the demo auth is a hardcoded `admin`
  credential with client-gated controls only; the mutating endpoints
  (`/api/signals/*`, `/api/source/mode`) are not server-side authenticated. Add
  real authn/authz and put the app behind TLS before any non-demo deployment.
