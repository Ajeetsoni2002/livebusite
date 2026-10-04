import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
test("ping responds without a database while readiness reports unavailable", async () => {
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  assert.equal((await request(app).get("/api/ping")).status, 200);
  const health = await request(app).get("/api/health");
  assert.equal(health.status, 503);
  assert.equal(health.body.data.database, "disconnected");
});
test("unknown route and denied CORS use consistent safe errors", async () => {
  const { createApp } = await import("../src/app.js");
  const app = createApp();
  const missing = await request(app).get("/api/not-real");
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.body.error.requestId, "string");
  assert.equal(
    (await request(app).get("/api/ping").set("Origin", "https://evil.example"))
      .status,
    403,
  );
});
