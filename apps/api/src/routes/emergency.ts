import { Router } from "express";
import { db } from "@workspace/db";
import { emergencyEventsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { simulator } from "../lib/simulation";
import type { VehicleType } from "../lib/simulation";

const router = Router();

const VALID_TYPES: VehicleType[] = ["ambulance", "fire_truck", "police"];
const VALID_LANES = [0, 1, 2, 3];

router.post("/emergency/trigger", async (req, res): Promise<void> => {
  const body = req.body as { lane_id?: number; vehicle_type?: string };
  const laneId = VALID_LANES.includes(Number(body.lane_id)) ? Number(body.lane_id) : Math.floor(Math.random() * 4);
  const vType = VALID_TYPES.includes(body.vehicle_type as VehicleType) ? (body.vehicle_type as VehicleType) : undefined;

  simulator.activateEmergency(laneId, vType);

  res.json({ success: true, lane_id: laneId, vehicle_type: vType ?? "random", message: `Emergency triggered on lane ${laneId}` });
});

router.get("/emergency/events", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

  const [events, liveState] = await Promise.all([
    db.select().from(emergencyEventsTable).orderBy(desc(emergencyEventsTable.timestamp)).limit(limit),
    Promise.resolve(simulator.peek()),
  ]);

  // Map DB rows to API shape
  const mapped = events.map((e) => ({
    id: e.id,
    junction_id: e.junctionId,
    lane_id: e.laneId,
    timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
    vehicle_type: e.vehicleType,
    confidence: e.confidence,
    duration_seconds: e.durationSeconds,
    resolved: e.resolved,
    resolved_at: e.resolvedAt instanceof Date ? e.resolvedAt.toISOString() : e.resolvedAt,
  }));

  // Merge the in-memory active emergency if it exists and is not yet in the DB.
  // Emergencies are only persisted to the DB on resolution, so an ongoing emergency
  // would be invisible in the log without this merge.
  const liveEmergency = liveState.emergency;
  if (liveEmergency && !liveEmergency.resolved) {
    const alreadyInDb = mapped.some(
      (e) => !e.resolved && e.lane_id === liveEmergency.lane_id
    );
    if (!alreadyInDb) {
      mapped.unshift({
        id: 0, // synthetic — not a real DB row
        junction_id: liveEmergency.junction_id,
        lane_id: liveEmergency.lane_id,
        timestamp: liveEmergency.timestamp,
        vehicle_type: liveEmergency.vehicle_type,
        confidence: liveEmergency.confidence,
        duration_seconds: liveEmergency.duration_seconds,
        resolved: false,
        resolved_at: null,
      });
    }
  }

  res.json({ events: mapped, total: mapped.length });
});

export default router;
