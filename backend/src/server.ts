import mongoose from "mongoose";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { startJobRunner } from "./processing/jobs.js";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let shuttingDown = false;
async function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Stopping API: ${reason}`);
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  if (server) {
    server.closeIdleConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await mongoose.disconnect();
  clearTimeout(deadline);
  process.exit(exitCode);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", () => void shutdown("unhandled rejection", 1));
process.on("uncaughtException", () => void shutdown("uncaught exception", 1));
try {
  mongoose.set("bufferCommands", false);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 10,
  });
  server = createApp().listen(config.port, "0.0.0.0", () =>
    console.info(`BUIT API listening on ${config.port}`),
  );
  startJobRunner();
} catch {
  console.error(
    "API startup failed: check MongoDB connectivity and environment settings.",
  );
  await mongoose.disconnect();
  process.exitCode = 1;
}
