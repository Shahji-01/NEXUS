import { Router } from "express";
import { getNetworkState, setWaveConfig } from "../lib/network-simulator";

const router = Router();

router.get("/network/state", (_req, res): void => {
  res.json(getNetworkState());
});

router.post("/network/wave-config", (req, res): void => {
  const { target_speed_kmh, wave_direction, enabled } = req.body as {
    target_speed_kmh?: number;
    wave_direction?: "northbound" | "southbound" | "both";
    enabled?: boolean;
  };
  setWaveConfig({ target_speed_kmh, wave_direction, enabled });
  res.json({ status: "ok" });
});

export default router;
