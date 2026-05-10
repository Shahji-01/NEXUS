/**
 * Multi-Junction Network Optimizer
 * Simulates 5 interconnected junctions along a city corridor with coordinated
 * green-wave propagation to minimise stop-and-go waves.
 */

import { simulator as mainSimulator, LANE_IDS } from "./simulation";

export interface JunctionNode {
  id: number;
  name: string;
  distance_m: number;
  density: number;
  avg_speed: number;
  congestion_level: string;
  current_phase: "green" | "yellow" | "red";
  green_offset_s: number;
  vehicles_queued: number;
  throughput_pct: number;
  delay_s: number;
}

export interface GreenWaveConfig {
  target_speed_kmh: number;
  wave_direction: "northbound" | "southbound" | "both";
  enabled: boolean;
}

export interface NetworkState {
  junctions: JunctionNode[];
  wave_config: GreenWaveConfig;
  total_delay_s: number;
  avg_throughput_pct: number;
  co2_saved_vs_uncoordinated_pct: number;
  wave_efficiency_pct: number;
  generated_at: string;
}

const JUNCTION_DEFS = [
  { id: 1, name: "NEXUS Primary",   distance_m: 0 },
  { id: 2, name: "MG Road",         distance_m: 450 },
  { id: 3, name: "Connaught Place", distance_m: 920 },
  { id: 4, name: "India Gate",      distance_m: 1380 },
  { id: 5, name: "Lodhi Colony",    distance_m: 1850 },
];

let _waveConfig: GreenWaveConfig = {
  target_speed_kmh: 40,
  wave_direction: "both",
  enabled: true,
};

export function getNetworkState(): NetworkState {
  const mainLanes = mainSimulator.getLanes();
  const mainDensity = LANE_IDS.reduce((s, id) => s + (mainLanes[id]?.density ?? 0), 0) / 4;
  const mainSpeed   = LANE_IDS.reduce((s, id) => s + (mainLanes[id]?.avg_speed ?? 40), 0) / 4;
  const speedMs     = (_waveConfig.target_speed_kmh * 1000) / 3600;

  const junctions: JunctionNode[] = JUNCTION_DEFS.map((def, idx) => {
    const travelTimeS = def.distance_m / speedMs;
    const offset      = _waveConfig.enabled ? Math.round(travelTimeS) : 0;

    const degradation  = 1 + idx * 0.05 * (mainDensity / 100);
    const density      = Math.min(100, mainDensity * degradation + (Math.random() - 0.5) * 6);
    const speed        = Math.max(5, mainSpeed * (1 - idx * 0.03) + (Math.random() - 0.5) * 4);
    const throughput   = Math.max(20, 100 - density * 0.6);
    const delay        = _waveConfig.enabled
      ? Math.max(2,  (density / 100) * 45 * (idx === 0 ? 0.6 : 0.85))
      : Math.max(5,  (density / 100) * 75);

    let phase: JunctionNode["current_phase"] = "red";
    if (_waveConfig.enabled) {
      const cycleS = 90;
      const t = ((Date.now() / 1000) + offset) % cycleS;
      phase = t < 40 ? "green" : t < 44 ? "yellow" : "red";
    }

    const level = density > 80 ? "critical" : density > 55 ? "high" : density > 30 ? "medium" : "low";

    return {
      id: def.id,
      name: def.name,
      distance_m: def.distance_m,
      density:          Math.round(density * 10) / 10,
      avg_speed:        Math.round(speed   * 10) / 10,
      congestion_level: level,
      current_phase: phase,
      green_offset_s: offset,
      vehicles_queued: Math.round((density / 100) * 15),
      throughput_pct:  Math.round(throughput * 10) / 10,
      delay_s:         Math.round(delay     * 10) / 10,
    };
  });

  const totalDelay     = junctions.reduce((s, j) => s + j.delay_s, 0);
  const avgThroughput  = junctions.reduce((s, j) => s + j.throughput_pct, 0) / junctions.length;
  const waveEff        = _waveConfig.enabled
    ? Math.round(Math.max(60, 100 - (totalDelay / junctions.length) * 0.5))
    : 50;
  const co2Saved       = _waveConfig.enabled
    ? Math.round(Math.max(0, (1 - totalDelay / (junctions.length * 75)) * 35) * 10) / 10
    : 0;

  return {
    junctions,
    wave_config: { ..._waveConfig },
    total_delay_s:                   Math.round(totalDelay    * 10) / 10,
    avg_throughput_pct:              Math.round(avgThroughput * 10) / 10,
    co2_saved_vs_uncoordinated_pct:  co2Saved,
    wave_efficiency_pct:             waveEff,
    generated_at:                    new Date().toISOString(),
  };
}

export function setWaveConfig(config: Partial<GreenWaveConfig>): void {
  _waveConfig = { ..._waveConfig, ...config };
}
