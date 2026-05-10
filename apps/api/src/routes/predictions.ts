import { Router } from "express";
import { simulator, LANE_IDS } from "../lib/simulation";
import { predictLane } from "../lib/prediction";

const router = Router();

router.get("/predictions", (_req, res): void => {
  const lanes = simulator.getLanes();
  const predictions = LANE_IDS.map((lid) => {
    const density = lanes[lid]?.density ?? 0;
    return predictLane(lid, density);
  });

  res.json({
    predictions,
    generated_at: new Date().toISOString(),
  });
});

export default router;
