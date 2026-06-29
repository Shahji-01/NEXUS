import { dataSourceManager } from "./data-source-manager";
import { updateDensityHistory } from "./prediction";
import { incidentDetector } from "./incident-detector";
import { emissionsCalculator } from "./emissions";
import { db } from "@workspace/db";
import { trafficLogsTable, emergencyEventsTable, signalLogsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcast } from "./websocket";

let _dbWriteCounter = 0;
let broadcastInterval: NodeJS.Timeout | null = null;

export function startBroadcaster() {
  if (broadcastInterval) return;

  broadcastInterval = setInterval(() => {
    const update = dataSourceManager.getUpdate();

    // Update prediction histories & feed incident detector
    Object.entries(update.lanes).forEach(([lid, lane]) => {
      updateDensityHistory(Number(lid), lane.density);
      incidentDetector.feed(Number(lid), lane.avg_speed, lane.density);
    });

    // Tick emissions calculator
    const lanesArr = Object.values(update.lanes);
    emissionsCalculator.tick(lanesArr);

    // Broadcast to all WS clients
    const payload = JSON.stringify(update);
    broadcast(payload);

    // Write signal logs on every tick (only when new green phases started)
    const pendingSignalLogs = dataSourceManager.getAndClearPendingSignalLogs();
    if (pendingSignalLogs.length > 0) {
      db.insert(signalLogsTable).values(
        pendingSignalLogs.map((sl) => ({
          laneId: sl.laneId,
          phase: sl.phase,
          greenTimeSec: sl.greenTimeSec,
          trigger: sl.trigger,
          densityAtTime: sl.densityAtTime,
        }))
      ).catch((err: unknown) => {
        logger.warn({ err }, "Failed to write signal log");
      });
    }

    // Write to DB every ~30 seconds (every 15th tick at 2s interval)
    _dbWriteCounter++;
    if (_dbWriteCounter % 15 === 0) {
      const ts = new Date();
      const rows = Object.values(update.lanes).map((lane) => ({
        laneId: lane.lane_id,
        timestamp: ts,
        vehicleCount: lane.vehicle_count,
        density: lane.density,
        cars: lane.cars,
        bikes: lane.bikes,
        trucks: lane.trucks,
        buses: lane.buses,
        avgSpeed: lane.avg_speed,
        congestionLevel: lane.congestion_level,
      }));

      db.insert(trafficLogsTable).values(rows).catch((err: unknown) => {
        logger.warn({ err }, "Failed to write traffic log");
      });

      // Persist emergency events
      if (update.emergency && update.emergency.resolved) {
        const ev = update.emergency;
        db.insert(emergencyEventsTable).values({
          junctionId: ev.junction_id,
          laneId: ev.lane_id,
          timestamp: new Date(ev.timestamp),
          vehicleType: ev.vehicle_type,
          confidence: ev.confidence,
          durationSeconds: ev.duration_seconds,
          resolved: ev.resolved,
          resolvedAt: ev.resolved_at ? new Date(ev.resolved_at) : null,
        }).catch((err: unknown) => {
          logger.warn({ err }, "Failed to write emergency event");
        });
      }
    }
  }, 2000);
}
