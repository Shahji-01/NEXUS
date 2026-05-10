import { Router } from "express";
import { simulator, LANE_IDS, LANE_NAMES } from "../lib/simulation";

const router = Router();

router.get("/transit/status", (_req, res): void => {
  const lanes = simulator.getLanes();
  const busPriority = simulator.getBusPriorityInfo();

  const laneStats = LANE_IDS.map((id) => {
    const lane = lanes[id];
    const busCount   = lane?.buses ?? 0;
    const total      = lane?.vehicle_count ?? 1;
    const busPct     = total > 0 ? (busCount / total) * 100 : 0;
    const density    = lane?.density ?? 0;
    const speed      = lane?.avg_speed ?? 0;
    const onTimePct  = Math.round(Math.max(55, 100 - density * 0.38));

    return {
      lane_id:              id,
      lane_name:            LANE_NAMES[id],
      bus_count:            busCount,
      bus_pct:              Math.round(busPct * 10) / 10,
      priority_active:      busPriority.active_lane === id,
      estimated_passengers: busCount * 42,
      avg_speed:            speed,
      density,
      on_time_pct:          onTimePct,
      delay_s:              Math.round(Math.max(0, (density / 100) * 90 * (1 - onTimePct / 100))),
    };
  });

  const totalBuses      = laneStats.reduce((s, l) => s + l.bus_count, 0);
  const totalPassengers = laneStats.reduce((s, l) => s + l.estimated_passengers, 0);
  const fleetOnTime     = Math.round(laneStats.reduce((s, l) => s + l.on_time_pct, 0) / 4);

  res.json({
    lane_stats:            laneStats,
    priority_lane:         busPriority.active_lane,
    priority_boost:        busPriority.boost,
    total_buses:           totalBuses,
    estimated_passengers:  totalPassengers,
    fleet_on_time_pct:     fleetOnTime,
    time_saved_s_per_bus:  busPriority.active_lane !== null ? 12 : 0,
    generated_at:          new Date().toISOString(),
  });
});

export default router;
