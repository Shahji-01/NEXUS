import { Router } from "express";
import { dataSourceManager, type DataSourceMode } from "../lib/data-source-manager";

const router = Router();

/** The set of valid data-source modes (Requirement 7.1). */
const VALID_MODES: readonly DataSourceMode[] = ["simulation", "video"];

function isValidMode(value: unknown): value is DataSourceMode {
  return typeof value === "string" && (VALID_MODES as readonly string[]).includes(value);
}

/**
 * GET /source/mode — report the active data-source mode plus the current
 * status (detection state, fallback flag, per-lane errors) for the dashboard
 * (Requirements 7.1, 7.7).
 */
router.get("/source/mode", (_req, res): void => {
  res.json({
    mode: dataSourceManager.getMode(),
    status: dataSourceManager.getStatus(),
  });
});

/**
 * POST /source/mode — switch the active producer. Validates the request body
 * `{ mode: "simulation" | "video" }`; on a missing/invalid mode responds 400
 * without mutating state. On success, swaps the mode (never disrupting the
 * dashboard WebSocket — R7.6) and echoes the resulting mode + status
 * (Requirements 7.3, 7.6).
 */
router.post("/source/mode", (req, res): void => {
  const { mode } = (req.body ?? {}) as { mode?: unknown };

  if (!isValidMode(mode)) {
    res.status(400).json({
      error: `Invalid mode. Expected one of: ${VALID_MODES.join(", ")}`,
    });
    return;
  }

  dataSourceManager.setMode(mode);

  res.json({
    mode: dataSourceManager.getMode(),
    status: dataSourceManager.getStatus(),
  });
});

export default router;
