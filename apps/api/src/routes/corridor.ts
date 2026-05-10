import { Router } from "express";
import { corridorManager } from "../lib/corridor";

const router = Router();

router.get("/corridor/status", (_req, res): void => {
  res.json(corridorManager.getLiveState());
});

router.get("/corridor/savings", (_req, res): void => {
  res.json(corridorManager.getLiveState().savings);
});

router.post("/corridor/speed", (req, res): void => {
  const { speed_kmh } = req.body as { speed_kmh?: number };
  if (speed_kmh === undefined || typeof speed_kmh !== "number") {
    res.status(400).json({ error: "speed_kmh (number) required" });
    return;
  }
  corridorManager.updateSpeed(speed_kmh);
  res.json({ status: "updated", speed_kmh });
});

export default router;
