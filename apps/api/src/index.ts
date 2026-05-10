import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { weatherService } from "./lib/weather";
import { setupWebSocketServer } from "./lib/websocket";
import { startBroadcaster } from "./lib/broadcaster";
import { seedAnalyticsIfEmpty } from "./lib/seeder";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Start weather polling (fetch immediately, then every 10 min)
weatherService.start();

const httpServer = createServer(app);

// Setup WebSocket Server
setupWebSocketServer(httpServer);

// Start Broadcasting Simulation
startBroadcaster();

// Start server
httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
  seedAnalyticsIfEmpty();
});
