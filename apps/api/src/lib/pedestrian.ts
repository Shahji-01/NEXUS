/**
 * Adaptive Pedestrian Safety Score
 * Calculates a real-time safety score (0–100) per junction crossing.
 * Risk factors: density (40%), time of day (25%), weather (20%), speed variance (15%)
 */

export type RiskLevel = "safe" | "caution" | "danger" | "critical";

export interface PedestrianSafetyResult {
  junction_id: number;
  safety_score: number;
  risk_level: RiskLevel;
  auto_extended: boolean;
  extension_added_s: number;
  risk_factors: {
    density_risk: number;
    time_risk: number;
    weather_risk: number;
    speed_risk: number;
    total_risk: number;
  };
  recommendation: string;
}

const SCHOOL_HOURS = [
  [7, 30, 9, 0],
  [13, 0, 14, 30],
  [16, 0, 17, 30],
] as [number, number, number, number][];

const MAX_EXTENSION_S = 30;

function isSchoolHours(hour: number, minute: number): boolean {
  const t = hour * 60 + minute;
  return SCHOOL_HOURS.some(([h1, m1, h2, m2]) => t >= h1 * 60 + m1 && t <= h2 * 60 + m2);
}

const WEATHER_RISK: Record<string, number> = {
  clear: 0, cloudy: 3, rain: 15, heavy_rain: 20, fog: 18, snow: 20,
};

export function calculatePedestrianSafety(
  junctionId: number,
  lanes: { density?: number; avg_speed?: number }[],
  weather = "clear",
  overrideHour?: number,
  overrideMinute?: number,
): PedestrianSafetyResult {
  const now = new Date();
  const hour = overrideHour ?? now.getHours();
  const minute = overrideMinute ?? now.getMinutes();

  // Factor 1: Density risk (0–40 pts)
  const avgDensity = lanes.length
    ? lanes.reduce((s, l) => s + (l.density ?? 0), 0) / lanes.length
    : 0;
  const densityRisk = Math.min(40, avgDensity * 0.4);

  // Factor 2: Time of day risk (0–25 pts)
  let timeRisk = 0;
  if (isSchoolHours(hour, minute)) timeRisk = 25;
  else if (hour >= 22 || hour < 6) timeRisk = 15;
  else if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) timeRisk = 18;

  // Factor 3: Weather risk (0–20 pts)
  const weatherRisk = WEATHER_RISK[weather.toLowerCase()] ?? 5;

  // Factor 4: Speed variance risk (0–15 pts)
  const speeds = lanes.map(l => l.avg_speed ?? 40).filter(s => s > 0);
  let speedRisk = 0;
  if (speeds.length >= 2) {
    const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
    const variance = speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length;
    speedRisk = Math.min(15, Math.sqrt(variance) * 0.5);
  }

  const totalRisk = densityRisk + timeRisk + weatherRisk + speedRisk;
  const safetyScore = Math.max(0, Math.min(100, 100 - totalRisk));

  const riskLevel: RiskLevel =
    safetyScore >= 75 ? "safe" :
    safetyScore >= 55 ? "caution" :
    safetyScore >= 35 ? "danger" : "critical";

  const autoExtended = safetyScore < 55;
  const extensionAddedS = autoExtended
    ? Math.min(MAX_EXTENSION_S, Math.round((55 - safetyScore) * (MAX_EXTENSION_S / 55)))
    : 0;

  const reasons: string[] = [];
  if (densityRisk > 25) reasons.push("high vehicle density");
  if (timeRisk >= 25)   reasons.push("school hours active");
  if (weatherRisk >= 15) reasons.push(`${weather} conditions`);
  if (speedRisk >= 10)  reasons.push("erratic vehicle speeds");

  const recommendation = reasons.length > 0
    ? (autoExtended
        ? `Auto-extended pedestrian phase +${extensionAddedS}s due to: ${reasons.join(", ")}.`
        : `Caution: ${reasons.join(", ")}.`)
    : "Crossing conditions are safe.";

  return {
    junction_id: junctionId,
    safety_score: Math.round(safetyScore * 10) / 10,
    risk_level: riskLevel,
    auto_extended: autoExtended,
    extension_added_s: extensionAddedS,
    risk_factors: {
      density_risk: Math.round(densityRisk * 10) / 10,
      time_risk: Math.round(timeRisk * 10) / 10,
      weather_risk: Math.round(weatherRisk * 10) / 10,
      speed_risk: Math.round(speedRisk * 10) / 10,
      total_risk: Math.round(totalRisk * 10) / 10,
    },
    recommendation,
  };
}
