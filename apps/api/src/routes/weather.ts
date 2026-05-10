import { Router } from "express";
import { weatherService } from "../lib/weather";

const router = Router();

router.get("/weather/current", (_req, res) => {
  res.json(weatherService.get());
});

export default router;
