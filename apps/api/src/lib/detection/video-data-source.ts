/**
 * VideoDataSource — adapts cached detector output into the canonical `LaneData`
 * / emergency-candidate shapes consumed by the rest of the API.
 *
 * This module enforces the LaneData *contract* (Requirement 6): regardless of
 * what the detector emits, the mapped lane data is normalised, clamped, and
 * re-derived so it is byte-compatible with the synthetic `SimulationEngine`
 * output. The functions here are **pure** — they take a `DetectionResult` and a
 * lane id and return a value with no I/O or shared state — so they can be
 * exhaustively property-tested.
 *
 * Cadence/fallback orchestration lives in `VideoDataSource.getLaneOutput()` at
 * the bottom of this file and builds on these pure mappers.
 */
import { logger } from "../logger";
import {
  congestionLevel,
  clampDensity,
  clampSpeed,
  LANE_DIRECTIONS,
  LANE_IDS,
  type LaneData,
  type EmergencyCandidate,
} from "../simulation";
import { detectionClient } from "./detection-client";
import type { DetectionClient, DetectionResult, DetectionStatus } from "./types";

/** Valid emergency vehicle types the detector may report (Requirement 5.1, 5.3). */
const EMERGENCY_TYPES = ["ambulance", "fire_truck", "police", "unknown"] as const;
type EmergencyType = (typeof EMERGENCY_TYPES)[number];

/**
 * Coerce a possibly-missing/negative/non-integer class count to a clean
 * non-negative integer. Detector output may be malformed (NaN, negative,
 * fractional), so we defend against all of it.
 */
function coerceCount(n: number | undefined | null): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

/**
 * Map a single `DetectionResult` to the canonical `LaneData` shape for the
 * given system lane id. Pure function — no side effects.
 *
 * Enforces the LaneData contract (Requirement 6):
 *  - `lane_id` is the supplied system lane id; `direction` is taken from the
 *    shared `LANE_DIRECTIONS` table (Requirements 6.1, 6.2).
 *  - class counts are copied and sanitised to non-negative integers (R2.4).
 *  - `vehicle_count` is **recomputed** as `cars + bikes + trucks + buses` and
 *    never trusts `result.vehicle_count` (Requirement 6.3).
 *  - `density` clamped to `[0, 100]`, `avg_speed` clamped to `[0, 200]` via the
 *    shared helpers (Requirements 4.1, 3.2, 3.3, 3.4).
 *  - `congestion_level` derived from the (clamped) density via the shared
 *    `congestionLevel` threshold function (Requirements 4.x, 6.4).
 */
export function mapResultToLaneData(result: DetectionResult, laneId: number): LaneData {
  const cars = coerceCount(result.cars);
  const bikes = coerceCount(result.bikes);
  const trucks = coerceCount(result.trucks);
  const buses = coerceCount(result.buses);

  const density = clampDensity(result.density);

  return {
    lane_id: laneId,
    direction: LANE_DIRECTIONS[laneId],
    cars,
    bikes,
    trucks,
    buses,
    // Recompute — do NOT trust result.vehicle_count (R6.3).
    vehicle_count: cars + bikes + trucks + buses,
    density,
    avg_speed: clampSpeed(result.avg_speed),
    congestion_level: congestionLevel(density),
  };
}

/**
 * Build an `EmergencyCandidate` from a `DetectionResult`, or `null` when the
 * result carries no emergency. Pure function.
 *
 * When the detector reports an indeterminate emergency type, it defaults to
 * `"unknown"` with confidence `0.0` (Requirement 5.3). Confidence is always
 * clamped into `[0, 1]` (Requirement 5.2). The candidate's `lane_id` mirrors the
 * (already system-mapped) `result.lane_id`.
 */
export function mapEmergencyCandidate(result: DetectionResult): EmergencyCandidate | null {
  const emergency = result.emergency;
  if (!emergency) return null;

  const type: EmergencyType = (EMERGENCY_TYPES as readonly string[]).includes(emergency.type)
    ? (emergency.type as EmergencyType)
    : "unknown";

  // Indeterminate type → confidence 0.0 (R5.3); otherwise clamp to [0, 1] (R5.2).
  const confidence =
    type === "unknown"
      ? 0.0
      : Number.isFinite(emergency.confidence)
        ? Math.min(1, Math.max(0, emergency.confidence))
        : 0.0;

  return {
    lane_id: result.lane_id,
    type,
    confidence,
  };
}

// =============================================================================
// Cadence / fallback orchestration
// =============================================================================

/**
 * Staleness window. A lane whose most recent result is older than this is
 * treated as not-fresh (~3 missed 2s broadcast ticks) and falls back to the
 * last-known mapped value or zero data (Requirements 8.2, 8.3).
 */
export const STALE_AFTER_MS = 6000;

/**
 * Minimum confidence for a detected emergency to be surfaced as a candidate.
 * Overridable via `EMERGENCY_CONFIDENCE_MIN` env. Indeterminate (`unknown`)
 * detections map to confidence `0.0` and are therefore excluded (Requirement 5.1).
 */
const DEFAULT_EMERGENCY_CONFIDENCE_MIN = 0.6;

function resolveEmergencyThreshold(): number {
  const raw = process.env.EMERGENCY_CONFIDENCE_MIN;
  if (raw === undefined) return DEFAULT_EMERGENCY_CONFIDENCE_MIN;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_EMERGENCY_CONFIDENCE_MIN;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * Output of one orchestration pass: a complete, contract-valid `LaneData` for
 * every system lane, the emergency candidates above threshold, and the overall
 * detection status surfaced to the dashboard (Requirements 9.4, 11.1, 7.7).
 */
export interface VideoLaneOutput {
  /** Always all four lanes `0..3` (Requirements 8.3, 9.4). */
  lanes: Record<number, LaneData>;
  emergencyCandidates: EmergencyCandidate[];
  status: DetectionStatus;
}

/**
 * A zeroed, contract-valid `LaneData` for a lane that has never produced a
 * result while in video mode: `vehicle_count = 0`, all classes `0`,
 * `congestion_level = "low"` (Requirement 8.3). Built by routing a zeroed
 * `DetectionResult` through the shared mapper so the contract stays identical.
 */
export function emptyLaneData(laneId: number): LaneData {
  return {
    lane_id: laneId,
    direction: LANE_DIRECTIONS[laneId],
    cars: 0,
    bikes: 0,
    trucks: 0,
    buses: 0,
    vehicle_count: 0,
    density: clampDensity(0),
    avg_speed: clampSpeed(0),
    congestion_level: congestionLevel(0),
  };
}

/**
 * Adapts the `DetectionClient` cache into canonical `LaneData` on the broadcast
 * cadence, applying staleness, last-known reuse, zero-fill, and unavailability
 * rules. `getLaneOutput()` is **total**: it always returns all four lanes with
 * valid `LaneData`, never throws, and lets the `DataSourceManager` decide
 * whether to apply simulation fallback based on the returned `status`
 * (Requirements 8.1, 8.2, 8.3, 9.4, 11.1, 11.2, 11.4, 7.8, 1.5, 2.5).
 */
export class VideoDataSource {
  private readonly client: DetectionClient;
  private readonly emergencyThreshold: number;

  /** Most recent non-empty mapped LaneData per lane, for stale/missing reuse (R8.2). */
  private readonly lastMapped: Record<number, LaneData> = {};

  constructor(client: DetectionClient = detectionClient) {
    this.client = client;
    this.emergencyThreshold = resolveEmergencyThreshold();
  }

  getLaneOutput(): VideoLaneOutput {
    try {
      return this.computeLaneOutput();
    } catch (err) {
      // MUST never throw — degrade to last-known/zero data so the broadcast tick
      // and the manager's fallback decision are never disrupted.
      logger.warn({ err }, "VideoDataSource.getLaneOutput fell back to last-known/zero");
      const lanes: Record<number, LaneData> = {};
      for (const laneId of LANE_IDS) {
        lanes[laneId] = this.lastMapped[laneId] ?? emptyLaneData(laneId);
      }
      return { lanes, emergencyCandidates: [], status: "unavailable" };
    }
  }

  private computeLaneOutput(): VideoLaneOutput {
    const snapshot = this.client.getSnapshot();
    const now = Date.now();

    const lanes: Record<number, LaneData> = {};
    const emergencyCandidates: EmergencyCandidate[] = [];

    let freshCount = 0;
    let staleOrErroredCount = 0;
    let everProducedCount = 0;

    for (const laneId of LANE_IDS) {
      const result = snapshot.results[laneId] as DetectionResult | undefined;
      const receivedAt = snapshot.receivedAt[laneId];
      const hasError = !!result?.error;
      const isFresh =
        !!result &&
        !hasError &&
        typeof receivedAt === "number" &&
        now - receivedAt < STALE_AFTER_MS;

      if (isFresh && result) {
        // Fresh detection → map, cache for future reuse, and harvest emergencies.
        const mapped = mapResultToLaneData(result, laneId);
        this.lastMapped[laneId] = mapped;
        lanes[laneId] = mapped;
        freshCount += 1;
        everProducedCount += 1;

        const candidate = mapEmergencyCandidate(result);
        if (candidate && candidate.confidence >= this.emergencyThreshold) {
          emergencyCandidates.push(candidate);
        }
      } else if (this.lastMapped[laneId]) {
        // Stale / missing / errored, but we have a previously mapped value (R8.2).
        lanes[laneId] = this.lastMapped[laneId];
        everProducedCount += 1;
        if (result || hasError || typeof receivedAt === "number") {
          staleOrErroredCount += 1;
        }
      } else {
        // Never produced a usable result for this lane → zero data (R8.3).
        lanes[laneId] = emptyLaneData(laneId);
        if (result || hasError || typeof receivedAt === "number") {
          staleOrErroredCount += 1;
        }
      }
    }

    const status = this.deriveStatus(
      snapshot.serviceReachable,
      freshCount,
      staleOrErroredCount,
      everProducedCount,
    );

    return { lanes, emergencyCandidates, status };
  }

  /**
   * Overall detection status surfaced to the dashboard (Requirement 11.1):
   *  - `unavailable` when the detector is unreachable (the manager may then
   *    apply simulation fallback — Requirements 11.2, 7.8).
   *  - `initializing` when reachable but no lane has produced a result yet.
   *  - `ready` when all four lanes are fresh.
   *  - `degraded` when reachable but some lanes are stale / errored / missing.
   */
  private deriveStatus(
    serviceReachable: boolean,
    freshCount: number,
    staleOrErroredCount: number,
    everProducedCount: number,
  ): DetectionStatus {
    if (!serviceReachable) return "unavailable";
    if (everProducedCount === 0 && staleOrErroredCount === 0) return "initializing";
    if (freshCount === LANE_IDS.length) return "ready";
    return "degraded";
  }
}

/** Shared singleton wired to the detection-client singleton. */
export const videoDataSource = new VideoDataSource();
