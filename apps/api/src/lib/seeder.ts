import { db } from "@workspace/db";
import { trafficLogsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function seedAnalyticsIfEmpty() {
  try {
    const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(trafficLogsTable);
    if (Number(row?.n ?? 0) > 0) return;

    const now = Date.now();
    type DensityFn = (h: number) => number;
    const PATTERNS: DensityFn[] = [
      (h) => h >= 7 && h <= 9 ? 68 : h >= 17 && h <= 19 ? 72 : h >= 10 && h <= 16 ? 42 : 18,
      (h) => h >= 7 && h <= 9 ? 62 : h >= 17 && h <= 19 ? 65 : h >= 10 && h <= 16 ? 38 : 15,
      (h) => h >= 7 && h <= 9 ? 78 : h >= 17 && h <= 19 ? 55 : h >= 10 && h <= 16 ? 33 : 12,
      (h) => h >= 7 && h <= 9 ? 52 : h >= 17 && h <= 19 ? 74 : h >= 10 && h <= 16 ? 30 : 10,
    ];

    const rows = [];
    for (let i = 47; i >= 0; i--) {
      const ts = new Date(now - i * 30 * 60 * 1000);
      const h = ts.getHours();
      for (let lane = 0; lane < 4; lane++) {
        const base = PATTERNS[lane]!(h);
        const density = Math.min(95, Math.max(5, base + (Math.random() * 18 - 9)));
        const vehicles = Math.round(density * 0.85 + Math.random() * 8);
        const speed = Math.max(10, 72 - density * 0.62 + Math.random() * 10 - 5);
        const cars = Math.round(vehicles * 0.68);
        const bikes = Math.round(vehicles * 0.1);
        const trucks = Math.round(vehicles * 0.13);
        const buses = Math.max(0, vehicles - cars - bikes - trucks);
        const level = density < 30 ? "low" : density < 55 ? "medium" : density < 75 ? "high" : "critical";
        rows.push({
          laneId: lane,
          timestamp: ts,
          vehicleCount: vehicles,
          density: Math.round(density * 10) / 10,
          cars,
          bikes,
          trucks,
          buses,
          avgSpeed: Math.round(speed * 10) / 10,
          congestionLevel: level,
        });
      }
    }

    await db.insert(trafficLogsTable).values(rows);
    logger.info({ rows: rows.length }, "Seeded analytics with 24h synthetic history");
  } catch (err) {
    logger.warn({ err }, "Analytics seed skipped");
  }
}
