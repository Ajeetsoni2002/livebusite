import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { HttpError, ok, requestId, errorHandler } from "./lib/http.js";
import {
  authRouter,
  requireUser,
  requireRole,
  requireCsrf,
} from "./modules/auth.js";
import { fileRouter } from "./modules/files.js";
import { catalogRouter } from "./modules/catalog.js";
import mongoSanitize from "express-mongo-sanitize";
import { contentWriteRouter } from "./modules/content-writes.js";
import { adminRouter } from "./modules/admin.js";
import { analyticsRouter, analyticsAdminRouter } from "./modules/analytics.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    requestId,
    helmet(),
    cors({
      origin(origin, cb) {
        cb(
          config.origins.includes(origin) || !origin
            ? null
            : new HttpError(403, "Origin is not allowed"),
          !origin || config.origins.includes(origin),
        );
      },
      credentials: true,
      exposedHeaders: ["ETag", "X-Request-ID"],
    }),
  );
  // Deliberately omit client IP, headers and query strings from request logs.
  app.use(
    pinoHttp({
      autoLogging: process.env.NODE_ENV !== "test",
      serializers: {
        req: (req) => ({ method: req.method }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      redact: ["req.headers", "req.remoteAddress", "err.stack"],
    }),
  );
  app.use(express.json({ limit: "256kb" }), cookieParser());
  app.get("/api/ping", (_req, res) => ok(res, { server: "alive" }));
  app.get("/api/health", (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503);
    ok(res, {
      server: "alive",
      database: ready ? "connected" : "disconnected",
    });
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({
          error: {
            code: "RATE_LIMIT",
            message: "Please wait before trying again.",
            requestId: res.locals.requestId,
          },
        }),
    }),
  );
  app.use("/api/auth", authRouter);
  app.use((req, _res, next) => {
    if (req.body && mongoSanitize.has(req.body))
      return next(new HttpError(400, "Invalid input keys"));
    next();
  });
  app.use("/api", fileRouter, catalogRouter, analyticsRouter);
  app.use(
    "/api/admin",
    requireCsrf,
    requireUser,
    requireRole("admin"),
    contentWriteRouter(true),
    adminRouter,
    analyticsAdminRouter,
  );
  app.use(
    "/api/contributor",
    requireCsrf,
    requireUser,
    requireRole("contributor"),
    contentWriteRouter(false),
  );
  app.use((_req, _res, next) =>
    next(new HttpError(404, "Route not found", "NOT_FOUND")),
  );
  app.use(errorHandler);
  return app;
}
