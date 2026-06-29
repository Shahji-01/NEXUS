/**
 * DetectionClient — the sole boundary between the Node API and the Python CV
 * microservice (see design.md → Components and Interfaces §2).
 *
 * Responsibilities:
 *  - Open a push WebSocket to `${DETECTOR_URL}/stream` and cache the latest
 *    `DetectionResult` per lane along with its `receivedAt` epoch ms (R8.2).
 *  - Reconnect with capped exponential backoff on disconnect, and while the
 *    socket is down, fall back to polling `GET /detections` at the broadcast
 *    cadence (~2s) (R11.1, R11.2, R11.3).
 *  - Apply the `Lane_Mapping` from `GET /config` so cached results are always
 *    keyed by system lane ids `0..3` (R10.5).
 *  - Expose overlay URLs proxied through the Node API (R9.1).
 *
 * `getSnapshot()` never throws — callers can rely on it inside the broadcast
 * tick without guarding.
 */
import { WebSocket } from "ws";
import { logger } from "../logger";
import { LANE_IDS } from "../simulation";
import type {
  DetectionClient as IDetectionClient,
  DetectionResult,
  DetectionSnapshot,
} from "./types";

const DEFAULT_DETECTOR_URL = "http://127.0.0.1:8099";
const POLL_INTERVAL_MS = 2000;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

const SYSTEM_LANE_IDS = new Set<number>(LANE_IDS as readonly number[]);

interface DetectionFrameMessage {
  type?: string;
  lane_id?: number;
  result?: DetectionResult | null;
  error?: { code: string; message: string } | null;
}

interface DetectionsResponse {
  service_status?: string;
  lanes?: Record<string, DetectionResult | null>;
}

interface ConfigResponse {
  lane_mapping?: Record<string, number>;
}

export class DetectionClientImpl implements IDetectionClient {
  private readonly baseUrl: string;

  private ws: WebSocket | null = null;
  private started = false;
  private serviceReachable = false;

  private results: Record<number, DetectionResult> = {};
  private receivedAt: Record<number, number> = {};
  private laneMapping: Record<string, number> = {};

  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(detectorUrl?: string) {
    const raw = detectorUrl ?? process.env.DETECTOR_URL ?? DEFAULT_DETECTOR_URL;
    this.baseUrl = raw.replace(/\/+$/, "");
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    logger.info({ detector: this.baseUrl }, "DetectionClient starting");
    // Best-effort config load (lane mapping); failure is non-fatal.
    void this.loadConfig();
    this.connect();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.clearReconnectTimer();
    this.stopPolling();
    this.closeSocket();
    this.serviceReachable = false;
    logger.info("DetectionClient stopped");
  }

  getSnapshot(): DetectionSnapshot {
    // MUST never throw — the broadcast tick depends on this.
    try {
      return {
        results: { ...this.results },
        serviceReachable: this.serviceReachable,
        receivedAt: { ...this.receivedAt },
      };
    } catch (err) {
      logger.warn({ err }, "DetectionClient.getSnapshot fell back to empty");
      return { results: {}, serviceReachable: false, receivedAt: {} };
    }
  }

  isReachable(): boolean {
    return this.serviceReachable;
  }

  fetchFrameUrl(laneId: number): string {
    return `/api/detection/lanes/${laneId}/stream`;
  }

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle
  // ---------------------------------------------------------------------------

  private connect(): void {
    if (!this.started) return;

    const wsUrl = this.toWsUrl("/stream");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      logger.warn({ err, wsUrl }, "DetectionClient failed to open WebSocket");
      this.handleDisconnect();
      return;
    }

    this.ws = ws;

    ws.on("open", () => {
      this.serviceReachable = true;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.stopPolling();
      logger.info({ wsUrl }, "DetectionClient WebSocket connected");
    });

    ws.on("message", (data: unknown) => {
      this.handleMessage(data);
    });

    ws.on("close", () => {
      logger.warn("DetectionClient WebSocket closed");
      this.handleDisconnect();
    });

    ws.on("error", (err: Error) => {
      logger.warn({ err: err.message }, "DetectionClient WebSocket error");
      // A 'close' event follows; reconnect/fallback handled there.
    });
  }

  private handleDisconnect(): void {
    this.serviceReachable = false;
    this.closeSocket();
    if (!this.started) return;
    // While the socket is down, poll HTTP and attempt to reconnect.
    this.startPolling();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    logger.info({ delayMs: delay }, "DetectionClient scheduling reconnect");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore — socket may already be closed
      }
      this.ws = null;
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP fallback polling
  // ---------------------------------------------------------------------------

  private startPolling(): void {
    if (this.pollTimer) return;
    logger.info({ intervalMs: POLL_INTERVAL_MS }, "DetectionClient starting HTTP-poll fallback");
    // Poll immediately, then on an interval.
    void this.pollDetections();
    this.pollTimer = setInterval(() => {
      void this.pollDetections();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollDetections(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/detections`);
      if (!res.ok) {
        this.serviceReachable = false;
        return;
      }
      const body = (await res.json()) as DetectionsResponse;
      this.serviceReachable = true;
      const lanes = body.lanes ?? {};
      for (const [key, result] of Object.entries(lanes)) {
        if (!result) continue;
        this.cacheResult(key, result);
      }
    } catch (err) {
      this.serviceReachable = false;
      logger.debug({ err }, "DetectionClient HTTP poll failed");
    }
  }

  private async loadConfig(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/config`);
      if (!res.ok) return;
      const body = (await res.json()) as ConfigResponse;
      if (body.lane_mapping && typeof body.lane_mapping === "object") {
        this.laneMapping = body.lane_mapping;
        logger.info({ laneMapping: this.laneMapping }, "DetectionClient loaded lane mapping");
      }
    } catch (err) {
      logger.debug({ err }, "DetectionClient failed to load /config (using identity mapping)");
    }
  }

  // ---------------------------------------------------------------------------
  // Message handling + caching
  // ---------------------------------------------------------------------------

  private handleMessage(data: unknown): void {
    let parsed: DetectionFrameMessage;
    try {
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data);
      parsed = JSON.parse(text) as DetectionFrameMessage;
    } catch (err) {
      logger.debug({ err }, "DetectionClient could not parse push message");
      return;
    }

    if (parsed.type && parsed.type !== "detection_frame") return;

    const result = parsed.result;
    if (!result) {
      // Per-lane error frame (result: null) — nothing to cache (R11.4).
      return;
    }

    // Resolve the keying source: explicit lane_id on the frame, then the result.
    const key =
      parsed.lane_id !== undefined && parsed.lane_id !== null
        ? String(parsed.lane_id)
        : result.detector_lane ?? String(result.lane_id);
    this.cacheResult(key, result);
  }

  /**
   * Cache a detection result keyed by *system* lane id, applying `Lane_Mapping`.
   * Results that cannot be resolved to a system lane id are dropped.
   */
  private cacheResult(key: string, result: DetectionResult): void {
    const laneId = this.resolveLaneId(key, result);
    if (laneId === null) {
      logger.debug({ key }, "DetectionClient could not resolve lane id; dropping result");
      return;
    }
    // Normalize the stored result so its lane_id is the system id.
    this.results[laneId] = { ...result, lane_id: laneId };
    this.receivedAt[laneId] = Date.now();
  }

  /**
   * Translate a detector lane key/result into a system lane id (`0..3`).
   * Order of precedence: configured Lane_Mapping (by key, then detector_lane),
   * then a numeric system lane id present on the result or key.
   */
  private resolveLaneId(key: string, result: DetectionResult): number | null {
    if (key in this.laneMapping) {
      const mapped = this.laneMapping[key];
      if (SYSTEM_LANE_IDS.has(mapped)) return mapped;
    }
    if (result.detector_lane && result.detector_lane in this.laneMapping) {
      const mapped = this.laneMapping[result.detector_lane];
      if (SYSTEM_LANE_IDS.has(mapped)) return mapped;
    }
    if (typeof result.lane_id === "number" && SYSTEM_LANE_IDS.has(result.lane_id)) {
      return result.lane_id;
    }
    const numericKey = Number(key);
    if (Number.isInteger(numericKey) && SYSTEM_LANE_IDS.has(numericKey)) {
      return numericKey;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private toWsUrl(path: string): string {
    const wsBase = this.baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    return `${wsBase}${path}`;
  }
}

/** Shared singleton used by the data-source pipeline. */
export const detectionClient: IDetectionClient = new DetectionClientImpl();
