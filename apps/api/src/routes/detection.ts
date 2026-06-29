/**
 * Detection routes — surface the data-source status and proxy the Python CV
 * service's annotated overlay frames/streams through the Node API so the
 * browser never contacts the detector process directly (see design.md →
 * Components and Interfaces §6).
 *
 * Routes (mounted at `/api`):
 *  - `GET /detection/status`              → `DataSourceStatus` (R7.7, R11.1).
 *  - `GET /detection/lanes/:laneId/frame`  → proxied `image/jpeg` (R9.1, R9.2).
 *  - `GET /detection/lanes/:laneId/stream` → proxied MJPEG multipart (R9.1, R9.4).
 *
 * The overlay endpoints proxy the detector at `${DETECTOR_URL}` (default
 * `http://127.0.0.1:8099`). They validate the lane id (`0..3`) and degrade
 * gracefully — an unreachable/erroring detector yields a small JSON error with
 * a `502`/`503` status rather than crashing the request. The MJPEG stream ties
 * an `AbortController` to the client `close` event so a browser disconnect
 * aborts the upstream fetch.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "node:stream";
import { dataSourceManager } from "../lib/data-source-manager";
import { LANE_IDS } from "../lib/simulation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEFAULT_DETECTOR_URL = "http://127.0.0.1:8099";

/** Valid system lane ids (`0..3`). */
const VALID_LANE_IDS = new Set<number>(LANE_IDS as readonly number[]);

/** Resolve the detector base URL at call time (honours `DETECTOR_URL`). */
function detectorBaseUrl(): string {
  const raw = process.env.DETECTOR_URL ?? DEFAULT_DETECTOR_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * Parse + validate a `:laneId` route param. Returns the numeric lane id, or
 * `null` when it is not an integer in `{0,1,2,3}`.
 */
function parseLaneId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string") {
    return null;
  }
  const laneId = Number(raw);
  if (!Number.isInteger(laneId) || !VALID_LANE_IDS.has(laneId)) {
    return null;
  }
  return laneId;
}

/**
 * GET /detection/status — report the current `DataSourceStatus` (mode,
 * detection state, fallback flag, per-lane errors, updated_at) for the
 * dashboard (Requirements 7.7, 11.1).
 */
router.get("/detection/status", (_req: Request, res: Response): void => {
  res.json(dataSourceManager.getStatus());
});

/**
 * GET /detection/lanes/:laneId/frame — proxy the latest annotated overlay JPEG
 * for a lane from the detector (Requirements 9.1, 9.2). Validates the lane id
 * (400 on bad id) and responds 502/503 with a small JSON error when the
 * detector is unreachable or errors, never crashing the request.
 */
router.get("/detection/lanes/:laneId/frame", async (req: Request, res: Response): Promise<void> => {
  const laneId = parseLaneId(req.params.laneId);
  if (laneId === null) {
    res.status(400).json({ error: "Invalid laneId. Expected an integer in 0..3." });
    return;
  }

  const url = `${detectorBaseUrl()}/lanes/${laneId}/frame`;
  // Abort the upstream fetch if the client goes away before it resolves.
  const controller = new AbortController();
  const onClose = (): void => controller.abort();
  req.on("close", onClose);

  try {
    const upstream = await fetch(url, { signal: controller.signal });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({
        error: `Detector returned ${upstream.status} for lane ${laneId} frame.`,
      });
      return;
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
    res.setHeader("Cache-Control", "no-store");

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    if (controller.signal.aborted) {
      // Client disconnected — nothing to send.
      if (!res.headersSent) res.end();
      return;
    }
    logger.warn({ err, laneId }, "detection frame proxy: detector unreachable");
    if (!res.headersSent) {
      res.status(503).json({ error: `Detector unreachable for lane ${laneId} frame.` });
    }
  } finally {
    req.off("close", onClose);
  }
});

/**
 * GET /detection/lanes/:laneId/stream — proxy the detector's MJPEG multipart
 * overlay stream for a lane (Requirements 9.1, 9.4). Pipes the upstream body
 * through to the client preserving the `content-type`
 * (`multipart/x-mixed-replace; boundary=...`). A client disconnect aborts the
 * upstream fetch via an `AbortController` tied to the request `close` event.
 * Upstream errors degrade gracefully to a 502 JSON error.
 */
router.get("/detection/lanes/:laneId/stream", async (req: Request, res: Response): Promise<void> => {
  const laneId = parseLaneId(req.params.laneId);
  if (laneId === null) {
    res.status(400).json({ error: "Invalid laneId. Expected an integer in 0..3." });
    return;
  }

  const url = `${detectorBaseUrl()}/lanes/${laneId}/mjpeg`;
  const controller = new AbortController();
  const onClose = (): void => controller.abort();
  req.on("close", onClose);

  try {
    const upstream = await fetch(url, { signal: controller.signal });
    if (!upstream.ok || !upstream.body) {
      req.off("close", onClose);
      res.status(502).json({
        error: `Detector returned ${upstream.status} for lane ${laneId} stream.`,
      });
      return;
    }

    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ?? "multipart/x-mixed-replace",
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");

    // Bridge the web ReadableStream body to a Node stream and pipe it through.
    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);

    nodeStream.on("error", (err: Error) => {
      if (controller.signal.aborted) return;
      logger.warn({ err: err.message, laneId }, "detection stream proxy: upstream stream error");
      if (!res.headersSent) {
        res.status(502).json({ error: `Detector stream error for lane ${laneId}.` });
      } else {
        res.end();
      }
    });

    // When the client disconnects, stop reading from upstream.
    res.on("close", () => {
      controller.abort();
      nodeStream.destroy();
    });

    nodeStream.pipe(res);
  } catch (err) {
    req.off("close", onClose);
    if (controller.signal.aborted) {
      if (!res.headersSent) res.end();
      return;
    }
    logger.warn({ err, laneId }, "detection stream proxy: detector unreachable");
    if (!res.headersSent) {
      res.status(502).json({ error: `Detector unreachable for lane ${laneId} stream.` });
    }
  }
});

export default router;
