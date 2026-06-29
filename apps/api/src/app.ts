import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

import path from "node:path";
import fs from "node:fs";

const app: Express = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve static files in production
const publicPath = path.resolve(process.cwd(), "dist/public");
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  // SPA fallback: serve index.html for client-side routes. Registered as a
  // pattern-free middleware because Express 5 / path-to-regexp v8 rejects the
  // bare "*" route pattern (it would throw at startup).
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(publicPath, "index.html"));
  });
}

export default app;
