# NEXUS — AI Junction Optimizer: Complete Running Guide

A real-time smart traffic junction control dashboard. This guide covers every step needed to install, configure, and run the full project from scratch.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Structure](#2-project-structure)
3. [Environment Variables](#3-environment-variables)
4. [Install Dependencies](#4-install-dependencies)
5. [Database Setup](#5-database-setup)
6. [Running the Project](#6-running-the-project)
7. [API Server In Depth](#7-api-server-in-depth)
8. [Frontend Dashboard In Depth](#8-frontend-dashboard-in-depth)
9. [Code Generation (OpenAPI → Hooks & Schemas)](#9-code-generation-openapi--hooks--schemas)
10. [Full Build & Typecheck](#10-full-build--typecheck)
11. [All Pages & Features](#11-all-pages--features)
12. [API Endpoints Reference](#12-api-endpoints-reference)
13. [Database Schema](#13-database-schema)
14. [Simulation Engine](#14-simulation-engine)
15. [Authentication](#15-authentication)
16. [WebSocket Protocol](#16-websocket-protocol)
17. [Common Gotchas](#17-common-gotchas)
18. [Workspace Package Reference](#18-workspace-package-reference)

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 24+ | Required. Use `node -v` to check. |
| pnpm | 9+ | Required. Run `npm i -g pnpm` if missing. |
| PostgreSQL | 14+ | Any hosted or local Postgres instance works. |

> Do **not** use `npm` or `yarn` — this project is pnpm-only. The `preinstall` script will reject any other package manager.

---

## 2. Project Structure

```
/
├── apps/
│   ├── api-server/          # Express 5 + WebSocket backend
│   │   ├── src/
│   │   │   ├── index.ts     # HTTP server + WS broadcaster
│   │   │   ├── app.ts       # Express app, middleware, route mounts
│   │   │   ├── packages/
│   │   │   │   ├── simulation.ts     # Traffic + signal state machine (singleton)
│   │   │   │   ├── prediction.ts     # 5/10/15-min congestion predictor
│   │   │   │   ├── emissions.ts      # CO₂ emissions calculator
│   │   │   │   ├── weather.ts        # Live weather poller
│   │   │   │   ├── incident-detector.ts
│   │   │   │   └── logger.ts
│   │   │   └── routes/
│   │   │       ├── traffic.ts        # /api/traffic/*
│   │   │       ├── signals.ts        # /api/signals/*
│   │   │       ├── emergency.ts      # /api/emergency/*
│   │   │       ├── predictions.ts    # /api/predictions
│   │   │       ├── auth.ts           # /api/auth/*
│   │   │       ├── copilot.ts        # /api/copilot (AI chat)
│   │   │       ├── analytics.ts      # /api/analytics/*
│   │   │       ├── corridor.ts       # /api/corridor/*
│   │   │       ├── emissions.ts      # /api/emissions/*
│   │   │       ├── incidents.ts      # /api/incidents/*
│   │   │       ├── network.ts        # /api/network/*
│   │   │       ├── pedestrian.ts     # /api/pedestrian/*
│   │   │       ├── schedule.ts       # /api/schedule/*
│   │   │       ├── scenarios.ts      # /api/scenarios/*
│   │   │       ├── transit.ts        # /api/transit/*
│   │   │       ├── weather.ts        # /api/weather
│   │   │       └── health.ts         # /api/healthz
│   │   └── build.mjs                 # esbuild bundle script
│   │
│   └── junction-dashboard/  # React + Vite frontend
│       └── src/
│           ├── pages/
│           │   ├── dashboard.tsx     # Live overview
│           │   ├── analytics.tsx     # Historical charts
│           │   ├── control.tsx       # Manual signal override (auth-gated)
│           │   ├── emergency.tsx     # Emergency events
│           │   ├── signal-log.tsx    # Signal timing log
│           │   ├── green-wave.tsx    # Green wave corridor optimizer
│           │   ├── copilot.tsx       # AI chat assistant
│           │   ├── carbon.tsx        # Carbon/emissions tracking
│           │   ├── incidents.tsx     # Incident detection log
│           │   ├── transit.tsx       # Transit priority
│           │   ├── network.tsx       # Network-wide optimization
│           │   ├── schedule.tsx      # Scheduled signal plans
│           │   └── scenarios.tsx     # What-if simulation
│           ├── components/
│           │   ├── layout/shell.tsx  # App shell + nav sidebar
│           │   └── traffic/          # TrafficLight, LaneCard
│           └── packages/
│               └── store.ts          # Zustand store (WebSocket feed)
│
├── packages/
│   ├── api-spec/
│   │   └── openapi.yaml              # OpenAPI contract (source of truth)
│   ├── api-client-react/
│   │   └── src/generated/            # Generated React Query hooks (do not edit)
│   ├── api-zod/
│   │   └── src/generated/            # Generated Zod schemas for backend (do not edit)
│   └── db/
│       └── src/schema/junction.ts    # Drizzle ORM schema
│
├── scripts/                          # Utility scripts
├── pnpm-workspace.yaml               # Workspace config, catalog pins
├── tsconfig.json                     # Root TS solution file (libs only)
├── tsconfig.base.json                # Shared strict TS defaults
└── package.json                      # Root task orchestration
```

---

## 3. Environment Variables

Two variables are **required** before the API server will start. Set them in your environment or a `.env`-equivalent before running.

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@localhost:5432/nexus` |
| `SESSION_SECRET` | Secret for HMAC-SHA256 auth token signing | Any long random string |

> On Local, set these in the **Secrets** tab (the lock icon in the sidebar). They are automatically injected as environment variables at runtime.

To verify they are set before starting:
```bash
echo $DATABASE_URL
echo $SESSION_SECRET
```

---

## 4. Install Dependencies

From the project root, install all workspace packages at once:

```bash
pnpm install
```

This installs dependencies for every package in the monorepo (`apps/*`, `packages/*`, `scripts`). You only need to run this once (or after adding new packages).

---

## 5. Database Setup

### Push the schema to Postgres

This creates (or syncs) all three tables — `traffic_logs`, `emergency_events`, and `signal_logs` — using Drizzle Kit:

```bash
pnpm --filter @workspace/db run push
```

You must re-run this command any time you change `packages/db/src/schema/junction.ts`.

### Seeding

No manual seed step is needed. When the API server starts and the `traffic_logs` table is empty, it automatically seeds **24 hours of synthetic historical data** across all 4 lanes (48 readings × 4 lanes = 192 rows), covering realistic rush-hour and off-peak density patterns.

---

## 6. Running the Project

The project has two services that must both be running: the **API server** and the **frontend dashboard**.

### Start the API Server

```bash
pnpm --filter @workspace/api run dev
```

What this does:
1. Compiles TypeScript → bundles with esbuild into `apps/api/dist/index.mjs`
2. Starts the Node.js server on the port defined by the `PORT` environment variable (default: `8080` in Local workflows)
3. The API is proxied and accessible at `/api`

> **Important:** The API server builds from source every time `dev` runs. After any code change to `apps/api/src/`, you must **restart this command** — hot-reload is not supported on the server side.

### Start the Frontend Dashboard

```bash
pnpm --filter @workspace/web run dev
```

What this does:
- Starts a Vite dev server on the port defined by `PORT` (default: `23304` in Local workflows)
- The dashboard is proxied and accessible at `/` (root)
- Vite HMR (hot module replacement) is active — frontend changes apply instantly without a restart

### Access the App

| Service | Local URL |
|---------|-----------|
| Dashboard (frontend) | `http://localhost:80/` |
| API (backend) | `http://localhost:80/api/` |
| Health check | `http://localhost:80/api/healthz` |
| WebSocket | `ws://localhost:80/api/ws` |

> When using `curl` or any shell command, always go through the shared proxy at `localhost:80`, never directly to port `8080` or `23304`.

### Running Both Together (Local)

In Local, both services are managed as **workflows** and start automatically. You can restart each independently:

- **API Server workflow:** `apps/api: API Server`
- **Dashboard workflow:** `apps/web: web`

---

## 7. API Server In Depth

**Package:** `@workspace/api`  
**Entry point:** `apps/api/src/index.ts`  
**Build tool:** esbuild (bundles everything into a single CJS-compatible ESM file)

### Build only (no start)
```bash
pnpm --filter @workspace/api run build
```
Output goes to `apps/api/dist/index.mjs`.

### Start only (from existing build)
```bash
pnpm --filter @workspace/api run start
```

### Typecheck only
```bash
pnpm --filter @workspace/api run typecheck
```

### What happens on startup

1. `PORT` is read and validated — server refuses to start without it.
2. `weatherService.start()` kicks off weather polling (immediate fetch + every 10 minutes).
3. HTTP server and WebSocket server are created on the same port.
4. The simulation broadcast loop starts: every 2 seconds, `simulator.tick()` advances the state machine and broadcasts to all connected WebSocket clients.
5. Signal logs (new green phase grants) are written to `signal_logs` on every tick that produces them.
6. Traffic logs are written to `traffic_logs` every 15 ticks (~30 seconds) to avoid write amplification.
7. Emergency events are persisted to `emergency_events` when they resolve.
8. `seedAnalyticsIfEmpty()` runs once — if `traffic_logs` is empty it inserts 24 hours of synthetic data.

### Logging

The server uses `pino` for structured JSON logging. In route handlers, use `req.log`. Outside routes, import the singleton `logger` from `./packages/logger`. **Never use `console.log` in server code.**

---

## 8. Frontend Dashboard In Depth

**Package:** `@workspace/web`  
**Entry point:** `apps/web/src/main.tsx`  
**Build tool:** Vite 7

### Build for production
```bash
pnpm --filter @workspace/web run build
```

### Typecheck only
```bash
pnpm --filter @workspace/web run typecheck
```

### Data flow

```
WebSocket /api/ws (2s tick)
        │
        ▼
  useTrafficStore (Zustand)      ←── reconnect logic with backoff
        │
        ▼
  Dashboard components           ←── subscribe to store slices
        │
        ├── LaneCard × 4
        ├── Signal Grid (animated)
        └── Prediction Area Chart

REST /api/* (React Query)        ←── initial load + periodic refetch
        │
        ├── Analytics page       ─── history, summary, hourly, congestion
        ├── Signal Log page      ─── /api/signals/log (10s auto-refresh)
        ├── Emergency page       ─── /api/emergency/events
        └── Control page         ─── /api/signals/state, /api/signals/override
```

### State management

All live traffic data (lanes, signals, emergency state, last sync time) is stored in a **Zustand store** (`src/packages/store.ts` → `useTrafficStore`). The WebSocket hook populates this store on every 2-second tick. React components subscribe to individual slices.

### Routing

Client-side routing via **Wouter**. Routes are defined in `src/main.tsx` and map to page components in `src/pages/`.

---

## 9. Code Generation (OpenAPI → Hooks & Schemas)

The OpenAPI spec at `packages/api-spec/openapi.yaml` is the **single source of truth** for the API contract. From it, two sets of files are generated automatically:

| Generated output | Location | Used by |
|-----------------|----------|---------|
| React Query hooks | `packages/api-client-react/src/generated/` | Frontend |
| Zod validation schemas | `packages/api-zod/src/generated/` | API server routes |

To regenerate after changing the spec:
```bash
pnpm --filter @workspace/api-spec run codegen
```

> Do **not** edit the files inside `generated/` directories by hand — they will be overwritten on the next codegen run.

Do not change `info.title` in `openapi.yaml` — the title controls the generated filenames and changing it will break all imports.

---

## 10. Full Build & Typecheck

### Typecheck everything (recommended before committing)
```bash
pnpm run typecheck
```
This runs `tsc --build` for composite libs first, then typechecks all artifact and script packages.

### Typecheck libs only
```bash
pnpm run typecheck:libs
```

### Full build (typecheck + bundle all packages)
```bash
pnpm run build
```

> **Note:** `pnpm run build` at the root needs `PORT` and `BASE_PATH` environment variables (supplied by Local workflows). It may fail when run directly from a shell without them. For verification, prefer `typecheck` over `build`.

---

## 11. All Pages & Features

| Page | Route | Auth Required | Description |
|------|-------|---------------|-------------|
| Dashboard | `/` | No | Live overview: 4 lane cards, animated 2×2 signal grid, 5/10/15-min prediction chart, KPI stats, camera placeholder |
| Analytics | `/analytics` | No | Historical charts: multi-lane density timeline, rush-hour profile, vehicle volume bar chart, congestion distribution. Lane filter + manual Refresh + CSV export |
| Control | `/control` | Yes (admin) | Manual signal override form (lane, duration, emergency priority). AI mode toggle. Live signal grid mirrored |
| Emergency | `/emergency` | No | Active emergency banner with pulse animation. Event log table with vehicle type icons, confidence %, duration, resolved/active badges |
| Signal Log | `/signal-log` | No | Every green phase grant: AI-triggered, manual override, or emergency preemption. KPI cards + table with density bar. Manual Refresh button |
| Green Wave | `/green-wave` | No | Corridor optimizer visualizing synchronized green waves across lanes. Status fetched every 2 seconds |
| AI Copilot | `/copilot` | No | Chat interface powered by Anthropic. Context-aware of live traffic state |
| What-If Sim | `/scenarios` | No | Simulate alternate traffic scenarios |
| Carbon | `/carbon` | No | CO₂ and emissions tracking per lane |
| Incidents | `/incidents` | No | Automated incident detection log |
| Transit Priority | `/transit` | No | Transit vehicle priority management |
| Network Opt. | `/network` | No | Network-wide signal optimization |
| Schedule | `/schedule` | No | Scheduled signal timing plans |

---

## 12. API Endpoints Reference

All endpoints are prefixed with `/api`.

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |

### Traffic
| Method | Path | Description |
|--------|------|-------------|
| GET | `/traffic/live` | Current live snapshot (uses `simulator.peek()`, no tick side-effect) |
| GET | `/traffic/history` | Paginated historical logs with accurate `total` COUNT |
| GET | `/traffic/summary` | Aggregate stats: avg density, peak hour, avg speed |

### Signals
| Method | Path | Description |
|--------|------|-------------|
| GET | `/signals/state` | Current signal phase for all lanes |
| POST | `/signals/override` | Manual override (auth required) |
| GET | `/signals/log` | Signal timing history (paginated) |

### Emergency
| Method | Path | Description |
|--------|------|-------------|
| GET | `/emergency/events` | All emergency events |
| POST | `/emergency/trigger` | Manually trigger an emergency |

### Predictions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/predictions` | 5, 10, 15-minute congestion predictions per lane |

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login with username + password, returns token |
| POST | `/auth/logout` | Invalidate session |
| GET | `/auth/me` | Current user info |

### AI
| Method | Path | Description |
|--------|------|-------------|
| POST | `/copilot` | AI chat message (Anthropic, context-aware) |

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/analytics/hourly` | Avg density/vehicles/speed grouped by hour |
| GET | `/analytics/congestion-distribution` | Congestion level distribution |

### Other
| Method | Path | Description |
|--------|------|-------------|
| GET | `/weather` | Live weather data |
| GET | `/emissions/snapshot` | Current CO₂ emissions per lane |
| GET | `/corridor/status` | Green wave corridor status |
| GET | `/incidents` | Detected incidents |
| POST | `/pedestrian/score` | Pedestrian crossing priority score |
| GET | `/network/optimization` | Network-wide optimization state |
| GET | `/schedule` | Scheduled timing plans |
| GET | `/scenarios` | What-if scenario definitions |
| GET | `/transit/priority` | Transit priority queue |

### WebSocket
| Path | Description |
|------|-------------|
| `/api/ws` | Real-time broadcast every 2 seconds. Payload: `{ lanes, signals, emergency, timestamp }` |

---

## 13. Database Schema

Three tables in PostgreSQL, managed via Drizzle ORM. Schema lives in `packages/db/src/schema/junction.ts`.

### `traffic_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `lane_id` | integer | 0=North, 1=South, 2=East, 3=West |
| `timestamp` | timestamptz | Default: now() |
| `vehicle_count` | integer | |
| `density` | real | Percentage 0–100 |
| `cars` | integer | |
| `bikes` | integer | |
| `trucks` | integer | |
| `buses` | integer | |
| `avg_speed` | real | km/h |
| `congestion_level` | text | `low` / `medium` / `high` / `critical` |

Index: `ix_traffic_logs_lane_time` on `(lane_id, timestamp)`.

### `emergency_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `junction_id` | integer | Default: 1 |
| `lane_id` | integer | |
| `timestamp` | timestamptz | |
| `vehicle_type` | text | `ambulance` / `fire_truck` / `police` |
| `confidence` | real | 0.0–1.0 |
| `duration_seconds` | integer | Nullable |
| `resolved` | boolean | Default: false |
| `resolved_at` | timestamptz | Nullable |

Index: `ix_emergency_events_ts` on `timestamp`.

### `signal_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `lane_id` | integer | |
| `timestamp` | timestamptz | Default: now() |
| `phase` | text | e.g. `green` |
| `green_time_sec` | integer | Duration of this green grant |
| `trigger` | text | `ai` / `manual` / `emergency` |
| `density_at_time` | real | Density when green was granted |

Index: `ix_signal_logs_ts` on `timestamp`.

> **Column naming:** Drizzle schema uses camelCase (`laneId`, `vehicleCount`) but all API responses map these to snake_case (`lane_id`, `vehicle_count`).

---

## 14. Simulation Engine

**File:** `apps/api/src/packages/simulation.ts`  
**Singleton:** imported as `simulator` everywhere in the server.

### Signal state machine

```
GREEN (AI-calculated duration)
  → YELLOW (4 seconds, fixed)
    → ALL_RED (2 seconds, fixed)
      → next GREEN (next lane by density priority)
```

- Only one lane is green at a time.
- AI mode calculates green duration based on current density and vehicle count (longer green for higher density).
- Emergency preemption grants an unconditional green to the detected lane for up to 2 minutes, bypassing the normal cycle.

### Key methods

| Method | Side effect | Description |
|--------|-------------|-------------|
| `simulator.tick()` | Advances state | Full simulation step — use only in the broadcast loop and on WS connect |
| `simulator.peek()` | None | Returns current state snapshot — use for REST reads |
| `simulator.getLanes()` | None | Returns current lane data without ticking |
| `simulator.getSignalState()` | None | Returns current signal phases without ticking |
| `simulator.getAndClearPendingSignalLogs()` | Clears buffer | Returns new green phase events since last call |

### Weather integration

The simulation is weather-aware. High wind, rain, or fog reduces average vehicle speeds and slightly increases density. Weather is fetched every 10 minutes by `weatherService` and injected into each tick.

### DB write cadence

| Event | When written |
|-------|-------------|
| Traffic logs | Every 15th tick (~30 seconds) |
| Signal logs | Every tick that produces a new green grant |
| Emergency events | When an emergency resolves (on the 15th-tick DB write) |

---

## 15. Authentication

Auth is a lightweight **HMAC-SHA256** signed token scheme — no user table in the database.

- **Credentials:** `admin` / `admin123` (hardcoded for demo)
- **Login:** `POST /api/auth/login` → returns a signed token
- **Protected routes:** Send the token as `Authorization: Bearer <token>` header
- In the frontend, the Control page checks auth state and redirects to a login form if not authenticated

The `SESSION_SECRET` environment variable is the HMAC key. Changing it invalidates all existing tokens.

---

## 16. WebSocket Protocol

### Connecting

```
ws://localhost:80/api/ws
```

### Message format (server → client, every 2 seconds)

```json
{
  "lanes": {
    "0": {
      "lane_id": 0,
      "vehicle_count": 12,
      "density": 34.5,
      "cars": 8,
      "bikes": 1,
      "trucks": 2,
      "buses": 1,
      "avg_speed": 42.3,
      "congestion_level": "medium",
      "direction": "north"
    },
    "1": { ... },
    "2": { ... },
    "3": { ... }
  },
  "signals": {
    "phases": { "0": "red", "1": "green", "2": "red", "3": "red" },
    "current_green": 1,
    "emergency_active": false,
    "emergency_lane": null,
    "manual_override": false,
    "time_remaining": 18,
    "ai_mode": true,
    "pedestrian_walk_active": false,
    "pedestrian_walk_remaining": 0
  },
  "emergency": null,
  "timestamp": "2026-05-10T07:28:00.000Z"
}
```

### Reconnect logic

The frontend WebSocket hook implements exponential backoff reconnection. Both `onerror` and `onclose` handlers clear any pending reconnect timer before scheduling a new one — preventing timer stacking during rapid disconnect/reconnect cycles.

### Fallback polling

If the WebSocket is disconnected, the dashboard falls back to polling `GET /api/traffic/live` every 2 seconds. This endpoint uses `simulator.peek()` (no tick side-effect) so it never double-advances the simulation.

---

## 17. Common Gotchas

| Situation | What to do |
|-----------|-----------|
| API server code changed | Restart the API server — it must rebuild the esbuild bundle |
| Drizzle schema changed | Run `pnpm --filter @workspace/db run push` |
| OpenAPI spec changed | Run `pnpm --filter @workspace/api-spec run codegen` |
| `PORT` not set | The API server will throw immediately on startup — set the env var |
| `DATABASE_URL` not set | Server starts but all DB queries fail — set the env var |
| Editor and CLI disagree on types | Trust `pnpm run typecheck` — it is authoritative |
| `pnpm run dev` at root | There is no root `dev` script — use the per-package commands above |
| Calling `curl` to a service port directly | Always go through `localhost:80` (the shared proxy) |
| Generated files look wrong | Do not edit `src/generated/` — re-run codegen instead |

---

## 18. Workspace Package Reference

| Package | Name | Description |
|---------|------|-------------|
| `apps/api` | `@workspace/api` | Express 5 backend + WebSocket broadcaster |
| `apps/web` | `@workspace/web` | React + Vite frontend dashboard |
| `packages/api-spec` | `@workspace/api-spec` | OpenAPI spec + Orval codegen config |
| `packages/api-client-react` | `@workspace/api-client-react` | Generated React Query hooks (do not edit) |
| `packages/api-zod` | `@workspace/api-zod` | Generated Zod schemas for backend (do not edit) |
| `packages/db` | `@workspace/db` | Drizzle ORM schema + DB client |
| `packages/integrations-anthropic-ai` | `@workspace/integrations-anthropic-ai` | Anthropic AI client (used by AI Copilot) |
| `scripts` | `@workspace/scripts` | Utility scripts |

---

*Generated for NEXUS — AI Junction Optimizer. Last updated: May 2026.*
