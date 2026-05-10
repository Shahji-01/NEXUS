/**
 * Simple congestion prediction engine.
 * Uses a moving average + trend extrapolation.
 */

interface LanePrediction {
  lane_id: number;
  current_density: number;
  prediction_5min: number;
  prediction_10min: number;
  prediction_15min: number;
  alert_level: "normal" | "watch" | "warning" | "critical";
}

const HISTORY_WINDOW = 30; // data points to keep
const densityHistory: Map<number, number[]> = new Map();

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function alertLevel(density: number): LanePrediction["alert_level"] {
  if (density > 80) return "critical";
  if (density > 60) return "warning";
  if (density > 40) return "watch";
  return "normal";
}

export function updateDensityHistory(laneId: number, density: number): void {
  if (!densityHistory.has(laneId)) densityHistory.set(laneId, []);
  const hist = densityHistory.get(laneId)!;
  hist.push(density);
  if (hist.length > HISTORY_WINDOW) hist.shift();
}

export function predictLane(laneId: number, currentDensity: number): LanePrediction {
  const hist = densityHistory.get(laneId) ?? [currentDensity];

  // Simple linear trend over last N points
  const n = hist.length;
  if (n < 2) {
    return {
      lane_id: laneId,
      current_density: currentDensity,
      prediction_5min: currentDensity,
      prediction_10min: currentDensity,
      prediction_15min: currentDensity,
      alert_level: alertLevel(currentDensity),
    };
  }

  // Moving average of last 5
  const recent = hist.slice(-5);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;

  // Trend: slope per data point
  const trend = n >= 3 ? (hist[n - 1] - hist[Math.max(0, n - 5)]) / Math.min(5, n - 1) : 0;

  // Each unit ~= 1 minute in our 2-second tick scenario → 5 min = 5 units... 
  // but ticks happen every 2s, so 5min = ~150 ticks; scale trend accordingly
  const ticksPerMin = 30; // ticks per minute at 2s interval
  const p5  = clamp(currentDensity + trend * 5  * ticksPerMin * 0.01, 0, 100);
  const p10 = clamp(currentDensity + trend * 10 * ticksPerMin * 0.01, 0, 100);
  const p15 = clamp(currentDensity + trend * 15 * ticksPerMin * 0.01, 0, 100);

  // Add mean-reversion pull
  const maxDensity = 75;
  const p5r  = clamp(p5  + (maxDensity - p5)  * 0.05, 0, 100);
  const p10r = clamp(p10 + (maxDensity - p10) * 0.10, 0, 100);
  const p15r = clamp(p15 + (maxDensity - p15) * 0.15, 0, 100);

  return {
    lane_id: laneId,
    current_density: Math.round(currentDensity * 10) / 10,
    prediction_5min:  Math.round(p5r  * 10) / 10,
    prediction_10min: Math.round(p10r * 10) / 10,
    prediction_15min: Math.round(p15r * 10) / 10,
    alert_level: alertLevel(Math.max(p5r, p10r, p15r)),
  };
}
