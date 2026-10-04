import { test } from "node:test";
import assert from "node:assert/strict";
test("production rejects ephemeral file storage", async () => {
  const { parseConfig } = await import("../src/config.js");
  assert.throws(
    () => parseConfig({ NODE_ENV: "production", STORAGE_DRIVER: "local" }),
    /storage|secret|JWT/i,
  );
});
test("development supports explicit CORS origins without secrets in source", async () => {
  const { parseConfig } = await import("../src/config.js");
  const c = parseConfig({
    NODE_ENV: "test",
    CORS_ORIGINS: "http://localhost:5173",
  });
  assert.deepEqual(c.origins, ["http://localhost:5173"]);
  assert.equal(c.storageDriver, "local");
});
