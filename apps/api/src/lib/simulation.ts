/**
 * Traffic simulation engine.
 * Generates realistic synthetic traffic with rush-hour peaks.
 * Implements the signal state machine: GREEN → YELLOW → ALL_RED → next GREEN
 * Includes periodic congestion spike events for demo purposes.
 * Weather-aware: speed, density and green times are adjusted by live conditions.
 */
import { weatherService } from "./weather";

export const LANE_NAMES = ["North Bound", "South Bound", "East Bound", "West Bound"] as const;
export const LANE_DIRECTIONS = ["north", "south", "east", "west"] as const;
export const LANE_IDS = [0, 1, 2, 3] as const;

export type Phase = "green" | "yellow" | "red" | "all_red" | "walk";
export type CongestionLevel = "low" | "medium" | "high" | "critical";
export type VehicleType = "ambulance" | "fire_truck" | "police";

export interface LaneData {
  lane_id: number;
  vehicle_count: number;
  density: number;
  cars: number;
  bikes: number;
  trucks: number;
  buses: number;
  avg_speed: number;
  congestion_level: CongestionLevel;
  direction: string;
}

export interface SignalState {
  phases: Record<number, Phase>;
  current_green: number | null;
  emergency_active: boolean;
  emergency_lane: number | null;
  manual_override: boolean;
  time_remaining: number;
  ai_mode: boolean;
  pedestrian_walk_active: boolean;
  pedestrian_walk_remaining: number;
}

export interface EmergencyEvent {
  id: number;
  junction_id: number;
  lane_id: number;
  timestamp: string;
  vehicle_type: VehicleType;
  confidence: number;
  duration_seconds: number | null;
  resolved: boolean;
  resolved_at: string | null;
}

export type SignalTrigger = "ai" | "manual" | "emergency";

export interface PendingSignalLog {
  laneId: number;
  phase: string;
  greenTimeSec: number;
  trigger: SignalTrigger;
  densityAtTime: number;
}

export interface TrafficUpdate {
  type: "traffic_update";
  timestamp: string;
  lanes: Record<number, LaneData>;
  signals: SignalState;
  emergency: EmergencyEvent | null;
  weather: ReturnType<typeof weatherService.get>;
  pressure_scores: Record<number, number>;
  adaptive_cycle_budget_sec: number;
  pedestrian_walk_active: boolean;
}

// Signal timing constants
const MIN_GREEN_TIME = 15_000;
const MAX_GREEN_TIME = 90_000;
const YELLOW_TIME = 4_000;
const ALL_RED_TIME = 2_000;
const EMERGENCY_TIMEOUT = 120_000;
const WALK_TIME = 12_000;

// Adaptive cycle budget range (total rotation across all 4 lanes)
const MIN_CYCLE_BUDGET = 60_000;   // quiet night — ~15s per lane
const MAX_CYCLE_BUDGET = 240_000;  // peak rush  — ~60s per lane

function getRushMultiplier(hour: number): number {
  // Indian traffic patterns: heavy morning (8–11), heavy evening (17–21), late night lighter
  if (hour >= 8  && hour < 11)  return 0.80 + Math.random() * 0.55;  // morning rush
  if (hour >= 12 && hour < 14)  return 0.55 + Math.random() * 0.30;  // lunch peak
  if (hour >= 17 && hour < 21)  return 0.85 + Math.random() * 0.55;  // evening rush (longer)
  if (hour >= 22 || hour < 6)   return 0.08 + Math.random() * 0.12;  // late night / early morning
  return 0.30 + Math.random() * 0.35;                                  // off-peak
}

function congestionLevel(density: number): CongestionLevel {
  if (density > 80) return "critical";
  if (density > 55) return "high";
  if (density > 30) return "medium";
  return "low";
}

let _emgIdCounter = 1;

export class SimulationEngine {
  private _lanes: Record<number, LaneData> = {};
  private _phases: Record<number, Phase> = { 0: "red", 1: "red", 2: "red", 3: "red" };
  private _currentGreen: number | null = null;
  private _greenEndTime = 0;
  private _phaseState: "green" | "yellow" | "all_red" | "walk" = "green";
  private _pedestrianRequested = false;
  private _phaseEndTime = 0;
  private _emergencyLane: number | null = null;
  private _emergencyStart: number | null = null;
  private _emergencyEndTime = 0;
  private _manualOverride = false;
  private _manualEndTime = 0;
  private _aiMode = true;
  private _activeEmergency: EmergencyEvent | null = null;
  private _startTime = Date.now();
  private _lastEmgCheck = Date.now();
  private _pendingSignalLogs: PendingSignalLog[] = [];
  // Adaptive cycle — tracks when each lane last received green
  private _lastGreenTime: Record<number, number> = { 0: Date.now(), 1: Date.now(), 2: Date.now(), 3: Date.now() };

  // Congestion spike system
  private _spikeLane: number | null = null;
  private _spikeEndTime = 0;
  private _spikeDensity = 0;
  private _lastSpikeCheck = Date.now();

  constructor() {
    this._phases[0] = "green";
    this._currentGreen = 0;
    this._greenEndTime = Date.now() + MIN_GREEN_TIME;
    this._phaseEndTime = Date.now() + MIN_GREEN_TIME;
    this._phaseState = "green";
    this._updateLanes();
  }

  private _updateLanes(): void {
    const now = new Date();
    const hour = now.getHours();
    const mult = getRushMultiplier(hour);
    const nowMs = Date.now();

    LANE_IDS.forEach((lid) => {
      const base = 8 + lid * 2;
      const totalFloat = base * mult * (1 + (Math.random() - 0.5) * 0.3);
      const total = Math.max(0, Math.round(totalFloat));
      let density = Math.min(100, (total / 20) * 100 + (Math.random() - 0.5) * 5);
      let vehicleCount = total;

      // Apply active spike
      if (this._spikeLane === lid && nowMs < this._spikeEndTime) {
        // Spike: ramp up to spike density with some jitter
        const progress = 1 - (this._spikeEndTime - nowMs) / (this._spikeEndTime - this._lastSpikeCheck);
        const spikeMagnitude = Math.min(1, progress * 3); // ramp up quickly
        density = density + (this._spikeDensity - density) * spikeMagnitude;
        density = Math.min(100, density + (Math.random() - 0.3) * 5);
        vehicleCount = Math.min(20, Math.round((density / 100) * 20));
      }

      const wx = weatherService.get();
      // Weather: rain/fog boosts density (slower throughput) and cuts speed
      const densityWeathered = Math.min(100, density * wx.density_factor);
      const densityFinal = Math.max(0, Math.round(densityWeathered * 10) / 10);

      // Indian urban traffic mix: heavy two-wheelers + auto-rickshaws (~40-50%)
      // bikes field = two-wheelers + autos combined
      const twoWheelers = Math.max(0, Math.round(vehicleCount * (0.40 + Math.random() * 0.10)));
      const cars        = Math.max(0, Math.round(vehicleCount * (0.28 + Math.random() * 0.06)));
      const trucks      = Math.max(0, Math.round(vehicleCount * (0.08 + Math.random() * 0.04)));
      const buses       = Math.max(0, Math.round(vehicleCount * (0.08 + Math.random() * 0.04)));

      // Indian urban speed: base 45 km/h (lower than UK), congestion + weather reduce it
      const rawSpeed = Math.max(5, 45 - vehicleCount * 1.2 + (Math.random() - 0.5) * 6);
      const speed = Math.max(5, rawSpeed * wx.speed_factor);

      this._lanes[lid] = {
        lane_id: lid,
        vehicle_count: vehicleCount,
        density: densityFinal,
        cars,
        bikes: twoWheelers,
        trucks,
        buses,
        avg_speed: Math.round(speed * 10) / 10,
        congestion_level: congestionLevel(densityFinal),
        direction: LANE_DIRECTIONS[lid],
      };
    });

    // Clear spike if expired
    if (this._spikeLane !== null && nowMs >= this._spikeEndTime) {
      this._spikeLane = null;
    }
  }

  private _checkSpikeTrigger(): void {
    const now = Date.now();
    if (this._spikeLane !== null) return;
    // Check every 90 seconds, 50% chance of triggering
    if (now - this._lastSpikeCheck < 90_000) return;
    this._lastSpikeCheck = now;
    if (Math.random() > 0.5) return;

    this._spikeLane = Math.floor(Math.random() * 4);
    // Spike to high (60-79%) or critical (82-95%)
    const isCritical = Math.random() > 0.5;
    this._spikeDensity = isCritical
      ? 82 + Math.random() * 13
      : 60 + Math.random() * 18;
    // Spike lasts 30-60 seconds
    this._spikeEndTime = now + 30_000 + Math.random() * 30_000;
  }

  /** Externally trigger a spike on a given lane (for demo/testing). */
  triggerSpike(laneId: number, level: "high" | "critical" = "high"): void {
    this._spikeLane = laneId;
    this._lastSpikeCheck = Date.now();
    this._spikeDensity = level === "critical"
      ? 85 + Math.random() * 10
      : 62 + Math.random() * 16;
    this._spikeEndTime = Date.now() + 45_000;
  }

  private _tickSignal(): void {
    const now = Date.now();

    if (this._emergencyLane !== null) {
      if (now > this._emergencyEndTime) {
        this._clearEmergency();
      } else {
        return;
      }
    }

    if (this._manualOverride) {
      if (now > this._manualEndTime) {
        this._manualOverride = false;
      } else {
        return;
      }
    }

    if (now < this._phaseEndTime) return;

    if (this._phaseState === "green") {
      if (this._currentGreen !== null) {
        this._phases[this._currentGreen] = "yellow";
        this._phaseState = "yellow";
        this._phaseEndTime = now + YELLOW_TIME;
      } else {
        this._phaseState = "all_red";
        this._phaseEndTime = now + ALL_RED_TIME;
      }
    } else if (this._phaseState === "yellow") {
      LANE_IDS.forEach((lid) => { this._phases[lid] = "all_red"; });
      this._phaseState = "all_red";
      this._phaseEndTime = now + ALL_RED_TIME;
      this._currentGreen = null;
    } else if (this._phaseState === "walk") {
      // Walk phase complete — brief clearance then next green
      LANE_IDS.forEach((lid) => { this._phases[lid] = "all_red"; });
      this._phaseState = "all_red";
      this._phaseEndTime = now + ALL_RED_TIME;
    } else {
      // all_red: check for pedestrian request first
      if (this._pedestrianRequested) {
        this._pedestrianRequested = false;
        LANE_IDS.forEach((lid) => { this._phases[lid] = "all_red"; });
        this._phaseState = "walk";
        this._phaseEndTime = now + WALK_TIME;
        return;
      }
      const nextLane = this._selectNextLane();
      const gt = this._computeAdaptiveGreen(nextLane);

      LANE_IDS.forEach((lid) => { this._phases[lid] = "red"; });
      this._phases[nextLane] = "green";
      this._currentGreen = nextLane;
      this._lastGreenTime[nextLane] = now;
      this._greenEndTime = now + gt;
      this._phaseState = "green";
      this._phaseEndTime = now + gt;

      this._pendingSignalLogs.push({
        laneId: nextLane,
        phase: "green",
        greenTimeSec: Math.round(gt / 1000),
        trigger: "ai",
        densityAtTime: Math.round((this._lanes[nextLane]?.density ?? 0) * 10) / 10,
      });
    }
  }

  /** Pressure score = density × wait-factor × bus-boost. Grows over time to prevent starvation. */
  private _computePressureScore(laneId: number): number {
    const density = this._lanes[laneId]?.density ?? 0;
    const waitMs = Date.now() - (this._lastGreenTime[laneId] ?? Date.now());
    const waitFactor = 1 + waitMs / 30_000; // +1 unit per 30s waiting

    // Bus priority: lanes with 2+ buses carrying many passengers get a boost
    const lane = this._lanes[laneId];
    const busPct = lane && lane.vehicle_count > 0 ? lane.buses / lane.vehicle_count : 0;
    const busBoost = lane && lane.buses >= 2 && busPct > 0.06 ? 1.5 : 1.0;

    return density * waitFactor * busBoost;
  }

  /** Pick the highest-pressure lane excluding the lane that just had green (unless all others are 0). */
  private _selectNextLane(): number {
    const scored = LANE_IDS.map((id) => ({ id, score: this._computePressureScore(id) }))
      .sort((a, b) => b.score - a.score);
    // Prefer a lane that isn't the one that just finished, unless it's the only meaningful one
    const notCurrent = scored.filter((s) => s.id !== this._currentGreen);
    if (notCurrent.length > 0 && notCurrent[0].score > 0) return notCurrent[0].id;
    return scored[0].id;
  }

  /**
   * Adaptive green time:
   *  1. Compute junction load (avg density across all lanes)
   *  2. Scale cycle budget from MIN_CYCLE (quiet) → MAX_CYCLE (rush)
   *  3. Allocate proportional share of budget to this lane
   *  4. Clamp to [MIN_GREEN_TIME, MAX_GREEN_TIME]
   */
  private _computeAdaptiveGreen(laneId: number): number {
    const densities = LANE_IDS.map((id) => this._lanes[id]?.density ?? 0);
    const totalDensity = densities.reduce((s, d) => s + d, 0) || 1;
    const avgLoad = totalDensity / LANE_IDS.length; // 0–100
    const cycleBudgetMs = MIN_CYCLE_BUDGET + (MAX_CYCLE_BUDGET - MIN_CYCLE_BUDGET) * (avgLoad / 100);
    const laneDensity = this._lanes[laneId]?.density ?? 0;
    const share = laneDensity / totalDensity;
    const allocated = Math.round(cycleBudgetMs * share);
    const ext = weatherService.get().green_extension_sec * 1000;
    return Math.min(MAX_GREEN_TIME, Math.max(MIN_GREEN_TIME, allocated + ext));
  }

  /** Returns normalised pressure scores (0–100) for all lanes, for UI display. */
  getPressureScores(): Record<number, number> {
    const raw = LANE_IDS.map((id) => this._computePressureScore(id));
    const maxScore = Math.max(...raw, 1);
    return Object.fromEntries(LANE_IDS.map((id, i) => [id, Math.round((raw[i] / maxScore) * 100)]));
  }

  /** Current adaptive cycle budget in seconds (based on live avg load). */
  getAdaptiveCycleBudgetSec(): number {
    const densities = LANE_IDS.map((id) => this._lanes[id]?.density ?? 0);
    const totalDensity = densities.reduce((s, d) => s + d, 0) || 1;
    const avgLoad = totalDensity / LANE_IDS.length;
    const budgetMs = MIN_CYCLE_BUDGET + (MAX_CYCLE_BUDGET - MIN_CYCLE_BUDGET) * (avgLoad / 100);
    return Math.round(budgetMs / 1000);
  }

  private _checkEmergencyTrigger(): void {
    const now = Date.now();
    // Random emergency ~once per 5 minutes in demo mode
    if (now - this._lastEmgCheck < 300_000) return;
    if (Math.random() > 0.4) {
      this._lastEmgCheck = now;
      return;
    }
    this._lastEmgCheck = now;

    const lane = Math.floor(Math.random() * 4);
    const types: VehicleType[] = ["ambulance", "fire_truck", "police"];
    const vtype = types[Math.floor(Math.random() * 3)];
    const conf = 0.82 + Math.random() * 0.16;

    this._emergencyLane = lane;
    this._emergencyStart = now;
    this._emergencyEndTime = now + EMERGENCY_TIMEOUT;
    this._manualOverride = false;

    LANE_IDS.forEach((lid) => { this._phases[lid] = "red"; });
    this._phases[lane] = "green";
    this._currentGreen = lane;
    this._phaseState = "green";
    this._phaseEndTime = this._emergencyEndTime;

    this._activeEmergency = {
      id: _emgIdCounter++,
      junction_id: 1,
      lane_id: lane,
      timestamp: new Date().toISOString(),
      vehicle_type: vtype,
      confidence: Math.round(conf * 100) / 100,
      duration_seconds: null,
      resolved: false,
      resolved_at: null,
    };

    this._pendingSignalLogs.push({
      laneId: lane,
      phase: "green",
      greenTimeSec: Math.round(EMERGENCY_TIMEOUT / 1000),
      trigger: "emergency",
      densityAtTime: Math.round((this._lanes[lane]?.density ?? 0) * 10) / 10,
    });
  }

  private _clearEmergency(): void {
    if (this._activeEmergency) {
      this._activeEmergency = {
        ...this._activeEmergency,
        resolved: true,
        resolved_at: new Date().toISOString(),
        duration_seconds: Math.round((Date.now() - (this._emergencyStart ?? Date.now())) / 1000),
      };
    }
    this._emergencyLane = null;
    this._emergencyStart = null;
    LANE_IDS.forEach((lid) => { this._phases[lid] = "red"; });
    this._phaseState = "all_red";
    this._phaseEndTime = Date.now() + ALL_RED_TIME;
    this._currentGreen = null;
    setTimeout(() => { this._activeEmergency = null; }, 5000);
  }

  tick(): TrafficUpdate {
    this._checkSpikeTrigger();
    this._updateLanes();
    this._checkEmergencyTrigger();
    this._tickSignal();

    const now = Date.now();
    const timeRemaining = this._currentGreen !== null
      ? Math.max(0, Math.round((this._greenEndTime - now) / 1000))
      : 0;
    const walkRemaining = this._phaseState === "walk"
      ? Math.max(0, Math.round((this._phaseEndTime - now) / 1000))
      : 0;

    return {
      type: "traffic_update",
      timestamp: new Date().toISOString(),
      lanes: { ...this._lanes },
      signals: {
        phases: { ...this._phases },
        current_green: this._currentGreen,
        emergency_active: this._emergencyLane !== null,
        emergency_lane: this._emergencyLane,
        manual_override: this._manualOverride,
        time_remaining: timeRemaining,
        ai_mode: this._aiMode,
        pedestrian_walk_active: this._phaseState === "walk",
        pedestrian_walk_remaining: walkRemaining,
      },
      emergency: this._activeEmergency,
      weather: weatherService.get(),
      pressure_scores: this.getPressureScores(),
      adaptive_cycle_budget_sec: this.getAdaptiveCycleBudgetSec(),
      pedestrian_walk_active: this._phaseState === "walk",
    };
  }

  getSignalState(): SignalState {
    const now = Date.now();
    const timeRemaining = this._currentGreen !== null
      ? Math.max(0, Math.round((this._greenEndTime - now) / 1000))
      : 0;
    const walkRemaining = this._phaseState === "walk"
      ? Math.max(0, Math.round((this._phaseEndTime - now) / 1000))
      : 0;
    return {
      phases: { ...this._phases },
      current_green: this._currentGreen,
      emergency_active: this._emergencyLane !== null,
      emergency_lane: this._emergencyLane,
      manual_override: this._manualOverride,
      time_remaining: timeRemaining,
      ai_mode: this._aiMode,
      pedestrian_walk_active: this._phaseState === "walk",
      pedestrian_walk_remaining: walkRemaining,
    };
  }

  getLanes(): Record<number, LaneData> {
    return { ...this._lanes };
  }

  getActiveSpikeInfo(): { lane: number | null; density: number; endsAt: number } {
    return {
      lane: this._spikeLane,
      density: this._spikeDensity,
      endsAt: this._spikeEndTime,
    };
  }

  manualOverride(laneId: number, durationSeconds: number): void {
    if (!LANE_IDS.includes(laneId as 0 | 1 | 2 | 3)) return;
    this._manualOverride = true;
    this._manualEndTime = Date.now() + durationSeconds * 1000;
    this._emergencyLane = null;

    LANE_IDS.forEach((lid) => { this._phases[lid] = "red"; });
    this._phases[laneId] = "green";
    this._currentGreen = laneId;
    this._greenEndTime = this._manualEndTime;
    this._phaseState = "green";
    this._phaseEndTime = this._manualEndTime;

    this._pendingSignalLogs.push({
      laneId,
      phase: "green",
      greenTimeSec: durationSeconds,
      trigger: "manual",
      densityAtTime: Math.round((this._lanes[laneId]?.density ?? 0) * 10) / 10,
    });
  }

  activateEmergency(laneId: number, vehicleType?: VehicleType): void {
    if (!LANE_IDS.includes(laneId as 0 | 1 | 2 | 3)) return;
    this._emergencyLane = laneId;
    this._emergencyStart = Date.now();
    this._emergencyEndTime = Date.now() + EMERGENCY_TIMEOUT;
    this._manualOverride = false;

    LANE_IDS.forEach((lid) => { this._phases[lid] = "red"; });
    this._phases[laneId] = "green";
    this._currentGreen = laneId;
    this._phaseState = "green";
    this._phaseEndTime = this._emergencyEndTime;

    const types: VehicleType[] = ["ambulance", "fire_truck", "police"];
    const vt: VehicleType = vehicleType ?? types[Math.floor(Math.random() * 3)]!;
    this._activeEmergency = {
      id: _emgIdCounter++,
      junction_id: 1,
      lane_id: laneId,
      timestamp: new Date().toISOString(),
      vehicle_type: vt,
      confidence: 0.99,
      duration_seconds: null,
      resolved: false,
      resolved_at: null,
    };

    this._pendingSignalLogs.push({
      laneId,
      phase: "green",
      greenTimeSec: Math.round(EMERGENCY_TIMEOUT / 1000),
      trigger: "emergency",
      densityAtTime: Math.round((this._lanes[laneId]?.density ?? 0) * 10) / 10,
    });
  }

  getAndClearPendingSignalLogs(): PendingSignalLog[] {
    const logs = this._pendingSignalLogs;
    this._pendingSignalLogs = [];
    return logs;
  }

  requestPedestrianCrossing(): void {
    this._pedestrianRequested = true;
  }

  isPedestrianWalkActive(): boolean {
    return this._phaseState === "walk";
  }

  /**
   * Returns the lane with the highest bus proportion (>2 buses) as the priority lane,
   * plus the boost multiplier applied to its pressure score.
   */
  getBusPriorityInfo(): { active_lane: number | null; boost: number } {
    let best: { lane: number; score: number } | null = null;
    LANE_IDS.forEach((id) => {
      const lane = this._lanes[id];
      if (!lane) return;
      const busPct = lane.vehicle_count > 0 ? (lane.buses / lane.vehicle_count) : 0;
      if (lane.buses >= 2 && busPct > 0.06) {
        const score = lane.buses * (1 + busPct);
        if (!best || score > best.score) best = { lane: id, score };
      }
    });
    const b = best as { lane: number; score: number } | null;
    return { active_lane: b?.lane ?? null, boost: b ? 1.5 : 1.0 };
  }

  /**
   * Returns the current simulation state without advancing any ticks.
   * Use this for read-only REST endpoints so they don't double-advance
   * the simulation alongside the WebSocket broadcast loop.
   */
  peek(): TrafficUpdate {
    const now = Date.now();
    const timeRemaining = this._currentGreen !== null
      ? Math.max(0, Math.round((this._greenEndTime - now) / 1000))
      : 0;
    const walkRemaining = this._phaseState === "walk"
      ? Math.max(0, Math.round((this._phaseEndTime - now) / 1000))
      : 0;

    return {
      type: "traffic_update",
      timestamp: new Date().toISOString(),
      lanes: { ...this._lanes },
      signals: {
        phases: { ...this._phases },
        current_green: this._currentGreen,
        emergency_active: this._emergencyLane !== null,
        emergency_lane: this._emergencyLane,
        manual_override: this._manualOverride,
        time_remaining: timeRemaining,
        ai_mode: this._aiMode,
        pedestrian_walk_active: this._phaseState === "walk",
        pedestrian_walk_remaining: walkRemaining,
      },
      emergency: this._activeEmergency,
      weather: weatherService.get(),
      pressure_scores: this.getPressureScores(),
      adaptive_cycle_budget_sec: this.getAdaptiveCycleBudgetSec(),
      pedestrian_walk_active: this._phaseState === "walk",
    };
  }

  setAiMode(enabled: boolean): void { this._aiMode = enabled; }
  getAiMode(): boolean { return this._aiMode; }
  getUptimeSeconds(): number { return Math.round((Date.now() - this._startTime) / 1000); }
}

export const simulator = new SimulationEngine();
