import { Router } from "express";
import { db } from "@workspace/db";
import { trafficLogsTable, emergencyEventsTable } from "@workspace/db";
import { sql, desc, and, eq } from "drizzle-orm";
import { simulator } from "../lib/simulation";


const router = Router();

router.get("/traffic/live", async (_req, res): Promise<void> => {
  const update = simulator.peek();
  res.json({
    timestamp: update.timestamp,
    demo_mode: true,
    lanes: update.lanes,
  });
});

router.get("/traffic/history", async (req, res): Promise<void> => {
  const laneId = req.query["lane_id"] ? Number(req.query["lane_id"]) : null;
  const limit = Math.min(Number(req.query["limit"] ?? 100), 1000);

  const conditions = [];
  if (laneId !== null && !isNaN(laneId)) {
    conditions.push(eq(trafficLogsTable.laneId, laneId));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow, items] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(trafficLogsTable)
      .where(whereClause),
    db
      .select()
      .from(trafficLogsTable)
      .where(whereClause)
      .orderBy(desc(trafficLogsTable.timestamp))
      .limit(limit),
  ]);

  const mapped = items.map((r) => ({
    id: r.id,
    lane_id: r.laneId,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
    vehicle_count: r.vehicleCount,
    density: r.density,
    cars: r.cars,
    bikes: r.bikes,
    trucks: r.trucks,
    buses: r.buses,
    avg_speed: r.avgSpeed,
    congestion_level: r.congestionLevel,
  }));

  res.json({ items: mapped, total: Number(countRow[0]?.count ?? mapped.length) });
});

// POST /traffic/spike — trigger a demo congestion spike on a lane
router.post("/traffic/spike", (req, res): void => {
  const laneId = Number(req.body?.lane_id ?? 0);
  const level = (req.body?.level === "critical" ? "critical" : "high") as "high" | "critical";
  if (laneId < 0 || laneId > 3) {
    res.status(400).json({ error: "lane_id must be 0-3" });
    return;
  }
  simulator.triggerSpike(laneId, level);
  const spike = simulator.getActiveSpikeInfo();
  res.json({
    ok: true,
    lane_id: laneId,
    level,
    target_density: Math.round(spike.density),
    expires_in_seconds: Math.round((spike.endsAt - Date.now()) / 1000),
  });
});

// GET /health/stats — server health metrics
router.get("/health/stats", async (_req, res): Promise<void> => {
  const [rowCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(trafficLogsTable);
  const spike = simulator.getActiveSpikeInfo();
  res.json({
    uptime_seconds: simulator.getUptimeSeconds(),
    db_rows: Number(rowCount?.count ?? 0),
    active_spike: spike.lane !== null ? {
      lane_id: spike.lane,
      density: Math.round(spike.density),
      expires_in: Math.max(0, Math.round((spike.endsAt - Date.now()) / 1000)),
    } : null,
  });
});

router.get("/traffic/summary", async (_req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();

  const [totalRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${trafficLogsTable.vehicleCount}), 0)` })
    .from(trafficLogsTable)
    .where(sql`${trafficLogsTable.timestamp} >= ${todayStr}`);

  const [avgRow] = await db
    .select({ avg: sql<number>`COALESCE(AVG(${trafficLogsTable.density}), 0)` })
    .from(trafficLogsTable)
    .where(sql`${trafficLogsTable.timestamp} >= ${todayStr}`);

  const [peakRow] = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${trafficLogsTable.timestamp})`,
    })
    .from(trafficLogsTable)
    .groupBy(sql`EXTRACT(HOUR FROM ${trafficLogsTable.timestamp})`)
    .orderBy(sql`SUM(${trafficLogsTable.vehicleCount}) DESC`)
    .limit(1);

  const [criticalRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(trafficLogsTable)
    .where(
      and(
        eq(trafficLogsTable.congestionLevel, "critical"),
        sql`${trafficLogsTable.timestamp} >= ${todayStr}`
      )
    );

  const [emgRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(emergencyEventsTable)
    .where(sql`${emergencyEventsTable.timestamp} >= ${todayStr}`);

  const liveLanes = Object.values(simulator.getLanes());
  const liveVehicles = liveLanes.reduce((s, l) => s + l.vehicle_count, 0);

  res.json({
    total_vehicles_today: Number(totalRow?.total ?? 0) + liveVehicles,
    avg_density: Math.round(Number(avgRow?.avg ?? 0) * 10) / 10,
    peak_hour: Number(peakRow?.hour ?? 8),
    critical_events_today: Number(criticalRow?.count ?? 0),
    emergency_events_today: Number(emgRow?.count ?? 0),
    system_uptime_seconds: simulator.getUptimeSeconds(),
  });
});

export default router;
