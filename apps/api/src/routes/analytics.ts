import { Router } from "express";
import { db } from "@workspace/db";
import { trafficLogsTable } from "@workspace/db";
import { sql, and, eq } from "drizzle-orm";

const router = Router();

// GET /analytics/hourly — average density by hour-of-day, optionally filtered by lane
router.get("/analytics/hourly", async (req, res): Promise<void> => {
  const laneId = req.query["lane_id"] != null ? Number(req.query["lane_id"]) : null;

  const conditions = [];
  if (laneId !== null && !isNaN(laneId)) {
    conditions.push(eq(trafficLogsTable.laneId, laneId));
  }

  const rows = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${trafficLogsTable.timestamp})::int`,
      avg_density: sql<number>`AVG(${trafficLogsTable.density})`,
      avg_vehicles: sql<number>`AVG(${trafficLogsTable.vehicleCount})`,
      avg_speed: sql<number>`AVG(${trafficLogsTable.avgSpeed})`,
      sample_count: sql<number>`COUNT(*)`,
    })
    .from(trafficLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(sql`EXTRACT(HOUR FROM ${trafficLogsTable.timestamp})`)
    .orderBy(sql`EXTRACT(HOUR FROM ${trafficLogsTable.timestamp})`);

  const data = rows.map((r) => ({
    hour: Number(r.hour),
    label: `${String(Number(r.hour)).padStart(2, "0")}:00`,
    avg_density: Math.round(Number(r.avg_density) * 10) / 10,
    avg_vehicles: Math.round(Number(r.avg_vehicles) * 10) / 10,
    avg_speed: Math.round(Number(r.avg_speed) * 10) / 10,
    sample_count: Number(r.sample_count),
  }));

  res.json({ data, lane_id: laneId });
});

// GET /analytics/congestion-distribution — count of each congestion level today
router.get("/analytics/congestion-distribution", async (req, res): Promise<void> => {
  const laneId = req.query["lane_id"] != null ? Number(req.query["lane_id"]) : null;

  const conditions = [];
  if (laneId !== null && !isNaN(laneId)) {
    conditions.push(eq(trafficLogsTable.laneId, laneId));
  }

  const rows = await db
    .select({
      level: trafficLogsTable.congestionLevel,
      count: sql<number>`COUNT(*)`,
    })
    .from(trafficLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(trafficLogsTable.congestionLevel);

  const levelMap: Record<string, number> = {};
  rows.forEach((r) => { levelMap[r.level] = Number(r.count); });

  res.json({
    distribution: [
      { level: "low", count: levelMap["low"] ?? 0, color: "#22c55e" },
      { level: "medium", count: levelMap["medium"] ?? 0, color: "#eab308" },
      { level: "high", count: levelMap["high"] ?? 0, color: "#f97316" },
      { level: "critical", count: levelMap["critical"] ?? 0, color: "#ef4444" },
    ],
  });
});

export default router;
