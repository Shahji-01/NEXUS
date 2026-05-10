/**
 * Green Wave Corridor Sync Engine
 * Computes phase offsets so a vehicle at target speed hits green at every junction.
 * offset(i) = (distance_i / speed_ms) mod cycle_length_i
 */

export type SignalPhase = "green" | "yellow" | "red";

export interface JunctionNode {
  junction_id: number;
  name: string;
  position_m: number;
  cycle_length_s: number;
  green_duration_s: number;
  yellow_duration_s: number;
  offset_s: number;
  current_phase: SignalPhase;
  phase_elapsed_s: number;
}

export interface CorridorState {
  corridor_id: string;
  name: string;
  target_speed_kmh: number;
  junctions: JunctionNode[];
  wave_active: boolean;
}

function buildDefaultJunctions(): JunctionNode[] {
  const defs = [
    { id: 0, name: "Gandhi Chowk",   pos: 0,    cycle: 90, green: 45 },
    { id: 1, name: "MG Road Cross",  pos: 300,  cycle: 90, green: 42 },
    { id: 2, name: "Station Circle", pos: 600,  cycle: 90, green: 40 },
    { id: 3, name: "Nehru Square",   pos: 900,  cycle: 90, green: 44 },
    { id: 4, name: "Airport Gate",   pos: 1200, cycle: 90, green: 38 },
  ];
  return defs.map(d => ({
    junction_id: d.id,
    name: d.name,
    position_m: d.pos,
    cycle_length_s: d.cycle,
    green_duration_s: d.green,
    yellow_duration_s: 3,
    offset_s: 0,
    current_phase: "red" as SignalPhase,
    phase_elapsed_s: 0,
  }));
}

function computeOffsets(junctions: JunctionNode[], speedKmh: number): JunctionNode[] {
  const speedMs = speedKmh / 3.6;
  const out = [...junctions];
  out[0].offset_s = 0;
  for (let i = 1; i < out.length; i++) {
    const dist = out[i].position_m - out[i - 1].position_m;
    const travel = dist / speedMs;
    out[i].offset_s = (out[i - 1].offset_s + travel) % out[i].cycle_length_s;
  }
  return out;
}

function getPhaseAt(j: JunctionNode, globalTime: number): { phase: SignalPhase; elapsed: number } {
  let adj = (globalTime - j.offset_s) % j.cycle_length_s;
  if (adj < 0) adj += j.cycle_length_s;
  const greenEnd = j.green_duration_s;
  const yellowEnd = greenEnd + j.yellow_duration_s;
  if (adj < greenEnd) return { phase: "green", elapsed: adj };
  if (adj < yellowEnd) return { phase: "yellow", elapsed: adj - greenEnd };
  return { phase: "red", elapsed: adj - yellowEnd };
}

function calculateSavings(junctions: JunctionNode[], speedKmh: number) {
  const n = junctions.length;
  const totalKm = junctions[n - 1].position_m / 1000;
  const dailyVehicles = 8000;

  const baselineStops = n;
  const waveStops = 0.3;
  const baselineCo2 = 180 * totalKm;
  const waveCo2 = 110 * totalKm;
  const co2SavedKgDaily = ((baselineCo2 - waveCo2) * dailyVehicles) / 1000;

  return {
    stops_reduced_pct: Math.round((1 - waveStops / baselineStops) * 1000) / 10,
    idle_time_saved_s: Math.round((baselineStops - waveStops) * 45 * 10) / 10,
    co2_saved_kg_per_vehicle: Math.round((baselineCo2 - waveCo2) / 100) / 10,
    co2_saved_kg_daily: Math.round(co2SavedKgDaily * 10) / 10,
    trees_equivalent_daily: Math.round((co2SavedKgDaily / 21.7) * 10) / 10,
    travel_time_improvement_pct: 38.0,
  };
}

class CorridorManager {
  private corridor: CorridorState;
  private startTime: number;

  constructor() {
    this.startTime = Date.now() / 1000;
    const junctions = computeOffsets(buildDefaultJunctions(), 50);
    this.corridor = {
      corridor_id: "main_arterial",
      name: "Main Arterial Corridor",
      target_speed_kmh: 50,
      junctions,
      wave_active: true,
    };
  }

  getLiveState() {
    const globalTime = Date.now() / 1000 - this.startTime;
    const junctions = this.corridor.junctions.map(j => {
      const { phase, elapsed } = getPhaseAt(j, globalTime);
      return {
        junction_id: j.junction_id,
        name: j.name,
        position_m: j.position_m,
        phase,
        phase_elapsed_s: Math.round(elapsed * 10) / 10,
        offset_s: Math.round(j.offset_s * 100) / 100,
        green_duration_s: j.green_duration_s,
        cycle_length_s: j.cycle_length_s,
      };
    });

    const savings = calculateSavings(this.corridor.junctions, this.corridor.target_speed_kmh);
    const speedMs = this.corridor.target_speed_kmh / 3.6;
    const totalLen = this.corridor.junctions[this.corridor.junctions.length - 1].position_m;
    const vehiclePath = this.corridor.junctions.map(j => {
      const arrivalTime = j.position_m / speedMs;
      const { phase } = getPhaseAt(j, (globalTime % 90) + arrivalTime);
      return {
        junction_id: j.junction_id,
        name: j.name,
        position_m: j.position_m,
        phase_on_arrival: phase,
        stopped: phase !== "green",
      };
    });

    return {
      corridor_id: this.corridor.corridor_id,
      name: this.corridor.name,
      target_speed_kmh: this.corridor.target_speed_kmh,
      wave_active: this.corridor.wave_active,
      global_time_s: Math.round(globalTime * 100) / 100,
      junctions,
      savings,
      vehicle_path: vehiclePath,
      total_length_m: totalLen,
    };
  }

  updateSpeed(speedKmh: number): boolean {
    const clamped = Math.max(10, Math.min(120, speedKmh));
    this.corridor.target_speed_kmh = clamped;
    this.corridor.junctions = computeOffsets(this.corridor.junctions, clamped);
    return true;
  }
}

export const corridorManager = new CorridorManager();
