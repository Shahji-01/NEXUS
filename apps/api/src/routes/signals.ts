import { Router } from "express";
import { simulator } from "../lib/simulation";
import { db } from "@workspace/db";
import { signalLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

router.get("/signals/state", (_req, res): void => {
  res.json(simulator.getSignalState());
});

router.post("/signals/override", async (req, res): Promise<void> => {
  const { lane_id, duration_seconds, emergency, reason } = req.body as {
    lane_id: number;
    duration_seconds: number;
    emergency?: boolean;
    reason?: string;
  };

  if (lane_id === undefined || lane_id === null || duration_seconds === undefined) {
    res.status(400).json({ error: "lane_id and duration_seconds are required" });
    return;
  }

  if (emergency) {
    simulator.activateEmergency(Number(lane_id));
  } else {
    simulator.manualOverride(Number(lane_id), Number(duration_seconds));
  }

  res.json({ status: "ok", lane_id: Number(lane_id), reason: reason ?? null });
});

router.post("/signals/ai-mode", (req, res): void => {
  const { enabled } = req.body as { enabled: boolean };
  simulator.setAiMode(Boolean(enabled));
  res.json({ ai_mode: simulator.getAiMode() });
});

router.post("/signals/pedestrian-request", (req, res): void => {
  simulator.requestPedestrianCrossing();
  res.json({ status: "queued", message: "Walk phase will activate after current green cycle" });
});

router.get("/signals/log", async (req, res): Promise<void> => {
  const limit = Math.min(500, Math.max(1, Number(req.query["limit"] ?? 100)));
  const laneId = req.query["lane_id"] !== undefined ? Number(req.query["lane_id"]) : undefined;

  const rows = await db
    .select()
    .from(signalLogsTable)
    .where(laneId !== undefined ? eq(signalLogsTable.laneId, laneId) : undefined)
    .orderBy(desc(signalLogsTable.timestamp))
    .limit(limit);

  const aiCount        = rows.filter((r) => r.trigger === "ai").length;
  const manualCount    = rows.filter((r) => r.trigger === "manual").length;
  const emergencyCount = rows.filter((r) => r.trigger === "emergency").length;
  const avgGreenSec    = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.greenTimeSec, 0) / rows.length)
    : 0;

  res.json({
    logs: rows.map((r) => ({
      id: r.id,
      lane_id: r.laneId,
      timestamp: r.timestamp.toISOString(),
      phase: r.phase,
      green_time_sec: r.greenTimeSec,
      trigger: r.trigger,
      density_at_time: r.densityAtTime,
    })),
    total: rows.length,
    summary: { ai_count: aiCount, manual_count: manualCount, emergency_count: emergencyCount, avg_green_sec: avgGreenSec },
  });
});

export default router;
