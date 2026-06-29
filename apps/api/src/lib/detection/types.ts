/**
 * Detection types shared across the Node ↔ Python detection boundary.
 *
 * These mirror the `Detection_Result` JSON contract emitted by the Python CV
 * microservice (see design.md → Data Models) and the cache/availability shapes
 * the `DetectionClient` exposes to the rest of the API. All results are keyed by
 * *system* lane ids (`0..3`) once the `Lane_Mapping` from `GET /config` has been
 * applied.
 */

// Re-export the canonical detection-emergency candidate shape so callers can
// import it from the detection module. It is structurally identical to (and
// re-declared compatibly with) the one in `../simulation`.
export type { EmergencyCandidate } from "../simulation";

/**
 * Service/detection availability surfaced to the dashboard (Requirement 11).
 */
export type DetectionStatus = "initializing" | "ready" | "degraded" | "unavailable";

/**
 * A single detector output for one lane, already mapped to a system lane id.
 * Shape matches the per-lane object in `GET /detections` and the `result` field
 * of a `/stream` `detection_frame` push message.
 */
export interface DetectionResult {
  /** System lane id (`0..3`) after `Lane_Mapping` has been applied. */
  lane_id: number;
  /** Original detector identifier (for audit / traceability). */
  detector_lane?: string;
  /** Exact count of detected vehicles (Requirement 2.4). */
  vehicle_count: number;
  cars: number;
  bikes: number;
  trucks: number;
  buses: number;
  /** Density bounded to `[0, 100]` (Requirement 4.1). */
  density: number;
  /** Average speed bounded to `[0, 200]` km/h (Requirement 3.4). */
  avg_speed: number;
  /** Congestion level derived from density (Requirement 4). */
  congestion_level: "low" | "medium" | "high" | "critical";
  /** Emergency-vehicle recognition, or `null`/absent when none (Requirement 5). */
  emergency?: {
    type: "ambulance" | "fire_truck" | "police" | "unknown";
    confidence: number; // 0..1
  } | null;
  frame_id: number;
  /** ISO timestamp from the detector. */
  produced_at: string;
  /** Per-lane error (one bad lane must not take down the others) (R2.5, R11.4). */
  error?: { code: string; message: string } | null;
}

/**
 * Point-in-time view of the detection cache plus reachability.
 * Returned by `DetectionClient.getSnapshot()` — never throws.
 */
export interface DetectionSnapshot {
  /** Latest result per system lane id. */
  results: Record<number, DetectionResult>;
  /** Whether the detector is currently reachable (Requirement 11.1). */
  serviceReachable: boolean;
  /** Epoch ms of the most recent result per lane (for staleness checks). */
  receivedAt: Record<number, number>;
}

/**
 * Sole boundary to the Python detection service. Owns the push WebSocket,
 * an in-memory per-lane cache, and HTTP fallbacks.
 */
export interface DetectionClient {
  /** Open the push WebSocket and begin caching results. Idempotent. */
  start(): void;
  /** Tear down the socket / timers. Idempotent. */
  stop(): void;
  /** Returns the current cache + reachability. MUST never throw. */
  getSnapshot(): DetectionSnapshot;
  /** Whether the detector is currently reachable (Requirement 11.1). */
  isReachable(): boolean;
  /** Proxied (Node-side) overlay URL for a lane (Requirement 9). */
  fetchFrameUrl(laneId: number): string;
}
