import { Router } from "express";
import { emissionsCalculator } from "../lib/emissions";

const router = Router();

router.get("/emissions/snapshot", (_req, res): void => {
  const snapshot = emissionsCalculator.getSnapshot();
  if (!snapshot) {
    res.status(503).json({ error: "No data yet — WebSocket tick has not fired" });
    return;
  }
  res.json(snapshot);
});

router.get("/emissions/today", (_req, res): void => {
  const snapshot = emissionsCalculator.getSnapshot();
  if (!snapshot) {
    res.json({ co2_saved_kg_today: 0, trees_equivalent: 0, cars_removed_equivalent: 0, idle_time_saved_s_today: 0 });
    return;
  }
  res.json({
    co2_saved_kg_today: snapshot.co2_saved_kg_today,
    trees_equivalent: snapshot.trees_equivalent,
    cars_removed_equivalent: snapshot.cars_removed_equivalent,
    idle_time_saved_s_today: snapshot.idle_time_saved_s_today,
  });
});

export default router;
