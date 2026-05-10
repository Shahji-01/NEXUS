import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { logger } from "./logger";
import { simulator } from "./simulation";

export const clients = new Set<WebSocket>();

export function setupWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.info({ clients: clients.size }, "WebSocket client connected");

    // Send initial state immediately
    const update = simulator.tick();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(update));
    }

    ws.on("close", () => {
      clients.delete(ws);
      logger.info({ clients: clients.size }, "WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.warn({ err: err.message }, "WebSocket error");
      clients.delete(ws);
    });
  });

  return wss;
}

export function broadcast(payload: string) {
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}
