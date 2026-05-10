import { Router } from "express";
import { calculatePedestrianSafety } from "../lib/pedestrian";

const router = Router();

router.post("/pedestrian/score", (req, res): void => {
  const { junction_id, lanes, weather, hour, minute } = req.body as {
    junction_id?: number;
    lanes?: { density?: number; avg_speed?: number }[];
    weather?: string;
    hour?: number;
    minute?: number;
  };

  const result = calculatePedestrianSafety(
    junction_id ?? 0,
    lanes ?? [],
    weather ?? "clear",
    hour,
    minute,
  );
  res.json(result);
});

router.get("/pedestrian/score/:junction_id", (req, res): void => {
  const junctionId = Number(req.params["junction_id"] ?? 0);
  const weather = String(req.query["weather"] ?? "clear");
  const result = calculatePedestrianSafety(junctionId, [], weather);
  res.json(result);
});

export default router;
