# NEXUS — AI Junction Optimizer

A real-time smart traffic-junction control dashboard. NEXUS visualizes and
optimizes a 4-lane intersection (North / South / East / West) using an adaptive
signal controller, live KPIs, congestion prediction, emergency-vehicle
preemption, weather awareness, and an AI copilot.

Traffic data comes from one of two interchangeable sources, switchable at
runtime:

- **Simulation** (default) — a synthetic traffic engine with realistic
  rush-hour patterns.
- **Video (computer vision)** — a Python YOLO/OpenCV service that detects
  vehicles from four lane video clips and feeds the same data pipeline.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Repository Layout](#repository-layout)
5. [Prerequisites](#prerequisites)
6. [Environment Variables](#environment-variables)
7. [Local Development](#local-development)
8. [Data Source Modes (Simulation vs Video)](#data-source-modes)
9. [Testing](#testing)
10. [API Reference](#api-reference)
11. [Database Schema](#database-schema)
12. [Deployment](#deployment)
    - [Pre-push security checklist](#a--pre-push-security-checklist)
    - [Push to GitHub](#b--push-to-github)
    - [Cloud: Vercel + Render](#c--cloud-deploy--vercel--render-free)
    - [Self-hosted: Docker Compose](#d--self-hosted--docker-compose-full-stack)
13. [Troubleshooting](#troubleshooting)
14. [What's Committed vs Ignored](#whats-committed-vs-ignored)
15. [Security Notes](#security-notes)
16. [Scripts Reference](#scripts-reference)

---

## Features

- **Live dashboard** — 4 lane cards, animated 2×2 signal grid, KPI stats,
  junction map, and a 5/10/15-minute congestion forecast.
- **Adaptive signal control** — a pressure-score scheduler (density × wait-time ×
  bus-priority) with an adaptive cycle budget, plus a `GREEN → YELLOW → ALL_RED`
  state machine, pedestrian walk phases, and emergency preemption.
- **Computer-vision detection** — a YOLO/OpenCV microservice detects vehicles
  (car / bike / truck / bus), estimates per-lane speed via cross-frame tracking,
  derives density/congestion, and recognizes emergency vehicles — all rendered as
  annotated overlays on the dashboard.
- **Runtime data-source toggle** — switch between simulation and video without a
  restart; video mode gracefully falls back to simulation if the detector is
  unavailable.
- **Real-time feed** — WebSocket broadcast every 2 seconds, with REST polling
  fallback.
- **Congestion prediction, CO₂ emissions, incident detection, transit & green-wave
  views, weather integration.**
- **AI Copilot** — natural-language operator commands powered by **Google Gemini**.
- **Historical analytics** — persisted to PostgreSQL (traffic, signal, and
  emergency logs).

---

## Architecture

```
                         ┌──────────────────────────────────────────┐
                         │  apps/web  (React + Vite dashboard)        │
                         │  REST (React Query) + WebSocket client     │
                         └───────────────┬────────────────────────────┘
                                         │  /api/*  +  /api/ws
                         ┌───────────────▼────────────────────────────┐
                         │  apps/api  (Express 5 + ws)                 │
                         │  ┌──────────────────────────────────────┐  │
                         │  │ DataSourceManager (simulation|video)  │  │
                         │  │   ├─ SimulationEngine                 │  │
                         │  │   └─ VideoDataSource ◀── DetectionClient
                         │  │ Broadcaster (2s tick) → WS + DB        │  │
                         │  └──────────────────────────────────────┘  │
                         └──────┬───────────────────────┬──────────────┘
                                │ Drizzle ORM           │ HTTP / WS
                     ┌──────────▼─────────┐   ┌──────────▼─────────────────┐
                     │  PostgreSQL         │   │  apps/detector (Python)    │
                     │  traffic/signal/    │   │  FastAPI + YOLO + OpenCV   │
                     │  emergency logs     │   │  background worker + cache │
                     └─────────────────────┘   └────────────────────────────┘
```

The API's `DataSourceManager` routes either the simulation or the video source
into a single broadcaster, so the `LaneData` / `TrafficUpdate` contract — and
everything downstream (dashboard, prediction, emissions, signal logic, DB) — is
identical regardless of source.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 7, TypeScript, Tailwind, Radix/shadcn, TanStack Query, Zustand, Wouter |
| Backend | Node 24, Express 5, `ws`, Pino, Drizzle ORM |
| Database | PostgreSQL 16 |
| Detector | Python 3.12, FastAPI, Ultralytics YOLO (`yolov8n`), OpenCV |
| AI | Google Gemini (AI Copilot) |
| Contract | OpenAPI → Orval codegen (React Query hooks + Zod schemas) |
| Tooling | pnpm workspaces, esbuild (API bundle), Vitest + fast-check, pytest |

---

## Repository Layout

```
/
├── apps/
│   ├── api/         # Express API + WebSocket (esbuild-bundled)
│   ├── web/         # React + Vite dashboard
│   └── detector/    # Python CV microservice (YOLO/OpenCV, FastAPI)
├── packages/
│   ├── api-spec/            # openapi.yaml (source of truth) + Orval config
│   ├── api-client-react/    # generated React Query hooks (do not edit)
│   ├── api-zod/             # generated Zod schemas (do not edit)
│   ├── db/                  # Drizzle schema + pg client
│   └── integrations-*/      # AI integration clients
├── .kiro/specs/             # feature specs (requirements / design / tasks)
├── docker-compose.yml       # full self-hosted stack (api + detector + db)
├── render.yaml              # Render blueprint (API + Postgres)
├── vercel.json              # Vercel config (dashboard)
└── .env.example             # environment template
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 24+ | `node -v` |
| pnpm | 10+ | `corepack enable` (the repo pins `pnpm@10.32.1`) |
| PostgreSQL | 14+ | local install or a Docker container |
| Python | 3.12+ | only needed to run the video detector |
| Docker | optional | for the full self-hosted stack / a local Postgres |

> This is a **pnpm-only** monorepo. Do not use `npm` or `yarn`.

---

## Environment Variables

Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Used by | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | api | yes (local) | API port (e.g. `8080`). Render injects this in prod. |
| `DATABASE_URL` | api, db | yes | PostgreSQL connection string |
| `SESSION_SECRET` | api | yes | HMAC key for auth tokens (long random string) |
| `DETECTOR_URL` | api | no | Detector base URL (default `http://127.0.0.1:8099`). Empty/unreachable → video mode falls back to simulation. |
| `GEMINI_API_KEY` | api | no | Enables the AI Copilot (Google Gemini) |
| `VITE_API_URL` | web (build) | prod only | API base URL baked into the dashboard build (cloud deploy). Local dev uses the Vite proxy. |
| `DETECTOR_WORKER` | detector | yes (serving) | Set to `1` to run the background detection worker |

`.env` is git-ignored. Never commit real secrets — `.env.example` (placeholders)
is the only env file in git.

---

## Local Development

### 1. Install

```bash
pnpm install
```

### 2. Start a database

Any PostgreSQL works. With Docker:

```bash
docker run -d --name nexus-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=nexus -p 5432:5432 postgres:16
# then set in .env:  DATABASE_URL=postgres://postgres:postgres@localhost:5432/nexus
```

### 3. Push the schema

```bash
pnpm --filter @workspace/db run push
```

### 4. Run the app (API + dashboard)

```bash
pnpm dev          # runs apps/api and apps/web together
```

- API: `http://localhost:8080` (REST at `/api`, WebSocket at `/api/ws`)
- Dashboard: the Vite dev server (default `http://localhost:5173`) proxies
  `/api` → `http://localhost:8080`.

On startup the API seeds 24h of synthetic history if the `traffic_logs` table is
empty.

> The API rebuilds (esbuild) each time `dev` runs; restart it after backend
> source changes. The dashboard has hot reload.

### 5. (Optional) Run the video detector

```bash
cd apps/detector
pip install -r requirements.txt              # installs CPU PyTorch + YOLO + OpenCV
# place four clips at: apps/detector/clips/lane_0.mp4 ... lane_3.mp4
DETECTOR_WORKER=1 python -m uvicorn app.main:app --host 127.0.0.1 --port 8099
```

The YOLO weights (`yolov8n.pt`) download automatically on first run.

Where to get demo clips: free traffic/intersection footage from
[Pexels](https://www.pexels.com/videos/), [Pixabay](https://pixabay.com/videos/),
or [Mixkit](https://mixkit.co/free-stock-video/traffic/). Name them
`lane_0.mp4` … `lane_3.mp4`. An elevated/overhead angle of a single road approach
detects best.

---

## Data Source Modes

The dashboard's **Data Source** toggle (or the API) switches the live source at
runtime. Default is `simulation`.

```bash
# switch to video
curl -X POST http://localhost:8080/api/source/mode \
  -H "Content-Type: application/json" -d '{"mode":"video"}'

# back to simulation
curl -X POST http://localhost:8080/api/source/mode \
  -H "Content-Type: application/json" -d '{"mode":"simulation"}'
```

In **video** mode the dashboard shows annotated overlays (bounding boxes + class
labels) per lane and a detection-status badge. If the detector is unreachable or
clips are missing, the API automatically falls back to simulation.

### How video detection works

1. Four bundled clips (`apps/detector/clips/lane_{0..3}.mp4`) loop continuously.
2. A single background worker reads frames, runs YOLO inference, tracks vehicles
   across frames for speed, derives density/congestion, and recognizes emergency
   vehicles — caching the latest result + annotated JPEG per lane. (Owning all
   capture reads in one worker avoids OpenCV's thread-unsafe concurrent decode
   and keeps the event loop responsive.)
3. The Node API's `DetectionClient` consumes the detector (WebSocket push with
   HTTP fallback), maps results into the canonical `LaneData`, and feeds the same
   broadcaster the simulation uses.
4. Overlay frames are proxied through the API at
   `/api/detection/lanes/{laneId}/stream` (the browser never contacts the
   detector directly).

> **Performance:** inference is CPU-bound, so motion refreshes ~1–2× per second.
> Overlay frames are downscaled + JPEG-compressed for smooth streaming. A GPU or
> smaller input size speeds it up.

---

## Testing

```bash
pnpm run typecheck                      # whole workspace
pnpm --filter @workspace/api run test   # API unit/property tests (Vitest + fast-check)
pnpm --filter @workspace/web run test   # web tests (Vitest + Testing Library)
cd apps/detector && python -m pytest    # detector tests (pytest)
```

---

## API Reference

All endpoints are prefixed with `/api`. Highlights (full contract in
`packages/api-spec/openapi.yaml`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| GET | `/traffic/live` | Current snapshot |
| GET | `/traffic/history` | Historical logs (paginated) |
| GET | `/traffic/summary` | Aggregate KPIs |
| GET | `/signals/state` | Current signal phases |
| POST | `/signals/override` | Manual lane override |
| POST | `/signals/ai-mode` | Toggle AI scheduling |
| GET | `/signals/log` | Signal timing log |
| GET | `/predictions` | 5/10/15-min congestion forecast |
| GET | `/emergency/events` | Emergency events |
| POST | `/copilot/command` | AI Copilot command (Gemini) |
| GET / POST | `/source/mode` | Get / set data source (`simulation` \| `video`) |
| GET | `/detection/status` | Detection status (mode, detection, fallback) |
| GET | `/detection/lanes/{laneId}/frame` | Proxied annotated JPEG |
| GET | `/detection/lanes/{laneId}/stream` | Proxied MJPEG overlay stream |
| WS | `/ws` | Real-time `TrafficUpdate` broadcast (every 2s) |

Regenerate the typed client/schemas after editing the spec:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Database Schema

Three tables (Drizzle ORM, `packages/db/src/schema/junction.ts`):

- **`traffic_logs`** — per-lane readings (counts, density, vehicle classes, speed,
  congestion).
- **`signal_logs`** — green-phase grants (`ai` / `manual` / `emergency`).
- **`emergency_events`** — detected emergency vehicles and resolutions.

Re-run `pnpm --filter @workspace/db run push` after changing the schema.

---

## Deployment

Two supported paths:

- **Cloud (free):** dashboard on **Vercel**, API + PostgreSQL on **Render**.
  The detector is not deployed on free tier, so the cloud app runs in
  **simulation mode** (video falls back gracefully).
- **Self-hosted:** full stack (API + dashboard + detector + DB) via
  **Docker Compose**.

### A) Pre-push security checklist

Already handled in this repo — verify before pushing:

- ✅ `.env` (real secrets) is git-ignored — **never commit it**.
- ✅ `.env.example` (placeholders only) **is** committed as the template.
- ✅ Model weights (`*.pt`) and demo clips (`apps/detector/clips/*.mp4`) are
  git-ignored.
- ✅ `node_modules/`, `dist/`, `*.tsbuildinfo`, `__pycache__/` are git-ignored.
- ✅ No API keys / tokens / private keys in tracked source.

Quick re-check:

```bash
git status                 # .env must NOT appear
git check-ignore .env      # should print ".env"
git ls-files | grep -i env # should only show .env.example
```

Secrets are provided at deploy time as **environment variables**, not files.

### B) Push to GitHub

```bash
git add .
git commit -m "NEXUS: deploy-ready"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git   # first time only
git push -u origin main
```

### C) Cloud deploy — Vercel + Render (free)

```
  Browser ─▶ Vercel (dashboard) ─HTTPS/WSS─▶ Render (API) ─▶ Render Postgres
             env: VITE_API_URL ──────────────▶ https://<api>.onrender.com
```

**Step 1 — Backend on Render (do first; the frontend needs its URL):**

1. <https://dashboard.render.com> → **New → Blueprint**, connect your repo.
2. Render reads `render.yaml` and provisions:
   - `nexus-db` — free PostgreSQL (database `nexus`)
   - `nexus-api` — the Node web service
3. Click **Apply**. Render automatically: injects `DATABASE_URL`, generates
   `SESSION_SECRET`, runs the build (`pnpm install → build API → push schema`),
   starts the API (reads Render's `PORT`), and health-checks `/api/healthz`.
4. (Optional) set `GEMINI_API_KEY` on `nexus-api` to enable the AI Copilot.
5. Copy the URL, e.g. `https://nexus-api.onrender.com`. Verify:
   `https://<api>.onrender.com/api/healthz` → `{"status":"ok"}`.

**Step 2 — Frontend on Vercel:**

1. <https://vercel.com/new> → import the **same** repo. Vercel reads
   `vercel.json` (build command, output `apps/web/dist/public`, SPA rewrites).
   Keep the **Root Directory** as the repo root.
2. Add an Environment Variable (Production + Preview):

   | Name | Value |
   |------|-------|
   | `VITE_API_URL` | `https://nexus-api.onrender.com` (no trailing slash, no `/api`) |

3. **Deploy.** Open the Vercel URL — the dashboard connects to the Render API.

> `VITE_API_URL` is compiled in at build time. If you change it, **redeploy** Vercel.

**Free-tier notes:** Render web services sleep after ~15 min idle (≈30–60 s cold
start on next request; the dashboard auto-reconnects and polls meanwhile). The
free Postgres expires after 90 days.

### D) Self-hosted — Docker Compose (full stack)

Runs API + dashboard + detector + PostgreSQL together. Services:

| Service | Role | Port |
|---------|------|------|
| `app` | Express API + bundled dashboard + WebSocket | 8080 |
| `detector` | Python CV microservice (worker enabled) | 8099 (internal) |
| `db` | PostgreSQL 16 (persisted volume) | 5432 (internal) |
| `migrate` | one-shot Drizzle schema push, then exits | — |

```bash
cp .env.example .env          # set a strong SESSION_SECRET
docker compose up --build -d  # → http://localhost:8080
```

Startup order is automatic: `db` (health-checked) → `migrate` → `detector` →
`app`. Provide the four `lane_{0..3}.mp4` clips in `apps/detector/clips/` (mounted
into the detector). Operate with:

```bash
docker compose logs -f app        # tail logs
docker compose ps                 # status
docker compose down               # stop (keeps the db volume)
docker compose down -v            # stop and delete the db volume
```

**Enabling video on Render (optional, paid):** the detector needs more than the
free 512 MB tier. Uncomment the `nexus-detector` service in `render.yaml`
(Docker runtime, paid plan, CPU PyTorch), provide clips, set `DETECTOR_URL` on
`nexus-api`, and redeploy.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| First cloud load is slow (~30–60 s) | Render free tier sleeps after ~15 min idle; it cold-starts on the next request. Normal. |
| Dashboard shows no data (cloud) | Ensure `VITE_API_URL` is set on Vercel and you **redeployed** after setting it. |
| WebSocket won't connect | It derives `wss://` from `VITE_API_URL` (cloud) or the proxy (local). The app polls as a fallback. |
| Render build fails on `pnpm` | The repo pins `packageManager: pnpm@10.32.1`; the build runs `corepack enable` first. |
| `TS6305 … dist not built` in Docker | Stale `*.tsbuildinfo` — it's git/docker-ignored so a clean build rebuilds composites. |
| Express crash `PathError: Missing parameter name` | Express 5 wildcard — the SPA fallback uses a pattern-free middleware (already fixed). |
| Detector OOM / huge image | Use the included CPU-only PyTorch (the Dockerfile installs the CPU wheel, not CUDA). |
| Video mode choppy | CPU inference ~1–2 fps; use a GPU or smaller input. Overlays are already downscaled. |
| DB tables missing | Run `pnpm --filter @workspace/db run push` (Docker/Render do this automatically). |


## Security Notes

- The included authentication is a **demo**: a hardcoded `admin` / `admin123`
  credential with client-side gating only, and the mutating endpoints
  (`/api/signals/*`, `/api/source/mode`) are **not** server-authenticated. Add
  real authn/authz before any non-demo / public deployment.
- Real secrets are environment variables, never committed.
- Both cloud platforms serve over HTTPS/WSS by default.

---

## Scripts Reference

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Run API + dashboard together (dev) |
| `pnpm run typecheck` | Typecheck the whole workspace |
| `pnpm run build` | Typecheck + build all packages |
| `pnpm --filter @workspace/db run push` | Push the Drizzle schema to the DB |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API client + Zod schemas from `openapi.yaml` |
| `pnpm --filter @workspace/api run test` | API tests (Vitest + fast-check) |
| `pnpm --filter @workspace/web run test` | Web tests (Vitest) |
| `docker compose up --build -d` | Run the full self-hosted stack |

---

*NEXUS — AI Junction Optimizer.*
