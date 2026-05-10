import { Router } from "express";
import { incidentDetector } from "../lib/incident-detector";

const router = Router();

router.get("/incidents", (_req, res): void => {
  res.json({
    active: incidentDetector.getActive(),
    resolved: incidentDetector.getResolved(),
    total_active: incidentDetector.getActive().length,
    generated_at: new Date().toISOString(),
  });
});

export default router;
