/**
 * DataSourceManager — the single point of routing between the two interchangeable
 * traffic producers: the synthetic `SimulationEngine` and the CV-driven
 * `VideoDataSource` (see design.md → Components and Interfaces §4).
 *
 * The broadcaster no longer calls `simulator.tick()` directly; instead it asks
 * this manager for a `TrafficUpdate` each 2-second tick. The manager:
 *   - holds the current `DataSourceMode` (default `"simulation"` — R7.2),
 *   - in `simulation` mode returns `simulator.tick()` byte-for-byte unchanged (R7.5),
 *   - in `video` mode pulls cached detection output via `videoDataSource`,
 *     applies system-wide fallback to simulation when the detector is
 *     unavailable with no usable last data (R7.8, R11.2), and drives the shared
 *     signal state machine via `simulator.tickWithLanes(...)` so signals /
 *     emergency preemption flow through the identical code path (R5.5, R7.4),
 *   - assembles the canonical `TrafficUpdate` whose field set is identical
 *     across modes (R6.5),
 *   - exposes `getStatus()` for the dashboard (mode, detection status,
 *     fallback flag, per-lane errors) and delegates `getAndClearPendingSignalLogs()`
 *     to the shared `SimulationEngine` buffer so persistence is mode-invariant.
 *
 * Switching modes (`setMode`) starts the `DetectionClient` when entering video
 * mode but never touches the WebSocket server or any client connections — the
 * dashboard socket stays up and simply begins receiving video-derived updates
 * (R7.3, R7.6).
 */
import { simulator, type TrafficUpdate, type EmergencyCandidate } from "./simulation";
import { videoDataSource, type VideoLaneOutput } from "./detection/video-data-source";
import { detectionClient } from "./detection/detection-client";
import type { DetectionStatus } from "./detection/types";
import { logger } from "./logger";

export type DataSourceMode = "simulation" | "video";

export interface DataSourceStatus {
  mode: DataSourceMode;
  /** ready | degraded | unavailable | initializing (Requirement 11.1). */
  detection: DetectionStatus;
  /** True when video mode is serving simulation/last-known data (Requirement 7.8, 11.2). */
  fallback_active: boolean;
  /** Per-lane error message, or `null` when the lane is healthy. */
  lane_errors: Record<number, string | null>;
  /** ISO timestamp of the last status update. */
  updated_at: string;
}

export class DataSourceManager {
  /** Authoritative mode. Defaults to simulation (Requirement 7.2). */
  private _mode: DataSourceMode = "simulation";

  /** Latest detection status from the video source (for `getStatus()`). */
  private _detection: DetectionStatus = "initializing";

  /** Whether the most recent video tick fell back to simulation/last data. */
  private _fallbackActive = false;

  /** Latest per-lane error map surfaced to the dashboard. */
  private _laneErrors: Record<number, string | null> = {};

  /** ISO timestamp of the last status mutation. */
  private _updatedAt: string = new Date().toISOString();

  getMode(): DataSourceMode {
    return this._mode;
  }

  /**
   * Switch the active producer. Entering `video` mode starts the
   * `DetectionClient` (idempotent) so it begins caching detector output; this
   * does NOT touch the WS server or any client connections — the existing
   * broadcast socket simply starts carrying video-derived updates
   * (Requirements 7.3, 7.6).
   */
  setMode(mode: DataSourceMode): void {
    if (mode === this._mode) {
      this._touch();
      return;
    }
    this._mode = mode;
    if (mode === "video") {
      // Begin (or resume) caching detector output. Idempotent — never disrupts
      // the dashboard WebSocket.
      detectionClient.start();
      this._detection = "initializing";
      this._fallbackActive = false;
    } else {
      // Returning to simulation: clear video-specific status.
      this._detection = "initializing";
      this._fallbackActive = false;
      this._laneErrors = {};
    }
    this._touch();
    logger.info({ mode }, "DataSourceManager mode changed");
  }

  /**
   * Status surfaced to the dashboard (Requirement 7.7). In simulation mode the
   * detection status is reported as `initializing` with no fallback/errors.
   */
  getStatus(): DataSourceStatus {
    return {
      mode: this._mode,
      detection: this._detection,
      fallback_active: this._fallbackActive,
      lane_errors: { ...this._laneErrors },
      updated_at: this._updatedAt,
    };
  }

  /**
   * Produce the next `TrafficUpdate` for the broadcaster.
   *  - simulation mode → `simulator.tick()` unchanged (Requirement 7.5).
   *  - video mode → map cached detection output, apply system-wide fallback to
   *    simulation when unavailable with no usable last data (R7.8, R11.2), and
   *    drive signals via the shared `tickWithLanes(...)` path (R5.5, R7.4). The
   *    returned update keeps the identical canonical field set (R6.5).
   */
  getUpdate(): TrafficUpdate {
    if (this._mode === "simulation") {
      const update = simulator.tick();
      // Additive descriptor — simulation mode never falls back and reports its
      // current detection status (Requirements 6.5, 7.7).
      update.data_source = {
        mode: "simulation",
        detection: this._detection,
        fallback_active: false,
      };
      return update;
    }
    return this._getVideoUpdate();
  }

  private _getVideoUpdate(): TrafficUpdate {
    let output: VideoLaneOutput;
    try {
      output = videoDataSource.getLaneOutput();
    } catch (err) {
      // `getLaneOutput()` is documented as total, but guard anyway so a tick is
      // never lost: degrade to a full simulation fallback.
      logger.warn({ err }, "DataSourceManager: video source threw; falling back to simulation");
      const update = simulator.tick();
      this._detection = "unavailable";
      this._fallbackActive = true;
      this._laneErrors = {};
      this._touch();
      update.data_source = {
        mode: "video",
        detection: this._detection,
        fallback_active: this._fallbackActive,
      };
      return update;
    }

    this._detection = output.status;
    this._laneErrors = this._collectLaneErrors(output);

    // System-wide fallback: when the detector is unavailable and the video
    // source has no usable last data, swap in freshly-generated simulation
    // lanes so signals still have meaningful input (Requirements 7.8, 11.2).
    let lanes = output.lanes;
    let emergencies: EmergencyCandidate[] = output.emergencyCandidates;
    if (output.status === "unavailable" && !this._hasUsableData(output)) {
      lanes = simulator.getLanes();
      // Don't carry detection emergencies forward when falling back to sim data.
      emergencies = [];
      this._fallbackActive = true;
    } else {
      this._fallbackActive = false;
    }

    this._touch();

    // Drive the shared signal state machine with the (possibly fallback) lanes.
    // `tickWithLanes` yields a TrafficUpdate with the identical field set as
    // `tick()` (Requirement 6.5).
    const update = simulator.tickWithLanes(lanes, emergencies);
    // Attach the additive source descriptor reflecting the post-compute status
    // (detection status + whether this tick fell back) — Requirements 6.5, 7.7.
    update.data_source = {
      mode: "video",
      detection: this._detection,
      fallback_active: this._fallbackActive,
    };
    return update;
  }

  /**
   * Whether the video output carries any non-empty (usable) lane data. A lane
   * is "usable" when it has any detected vehicles; an all-zero set means the
   * source only has empty/never-produced data.
   */
  private _hasUsableData(output: VideoLaneOutput): boolean {
    return Object.values(output.lanes).some((lane) => lane.vehicle_count > 0);
  }

  /** Build the per-lane error map for `getStatus()` (currently best-effort). */
  private _collectLaneErrors(_output: VideoLaneOutput): Record<number, string | null> {
    // The video source does not currently surface structured per-lane errors on
    // its output; degraded/unavailable status is reflected via `detection`.
    return {};
  }

  /**
   * Drain the shared pending signal-log buffer. Delegates to the single
   * `SimulationEngine` buffer used by both `tick()` and `tickWithLanes()`, so
   * AI/manual/emergency signal logs persist identically in both modes
   * (Requirement 10.3).
   */
  getAndClearPendingSignalLogs() {
    return simulator.getAndClearPendingSignalLogs();
  }

  private _touch(): void {
    this._updatedAt = new Date().toISOString();
  }
}

/** Shared singleton used by the broadcaster and REST routes. */
export const dataSourceManager = new DataSourceManager();
