import { Router } from "express";
import { runScenario, SCENARIO_TYPES, type LaneSnapshot } from "../lib/scenario";

const router = Router();

router.post("/scenarios/run", (req, res): void => {
  const { scenario_type, params, current_lanes } = req.body as {
    scenario_type?: string;
    params?: Record<string, unknown>;
    current_lanes?: LaneSnapshot[];
  };

  if (!scenario_type) {
    res.status(400).json({ error: "scenario_type required" });
    return;
  }

  const result = runScenario(scenario_type, params ?? {}, current_lanes ?? []);
  res.json(result);
});

router.get("/scenarios/types", (_req, res): void => {
  res.json({ types: SCENARIO_TYPES });
});

export default router;
