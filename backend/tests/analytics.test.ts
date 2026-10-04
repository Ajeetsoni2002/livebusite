import { test } from "node:test";
import assert from "node:assert/strict";
test("daily hashes rotate at Kolkata midnight and search queries redact private text", async () => {
  const { dayKey, visitorKey, normalizeQuery } =
    await import("../src/modules/analytics.js");
  assert.equal(dayKey(new Date("2026-10-02T18:31:00Z")), "2026-10-03");
  const req: any = { ip: "192.0.2.1", get: () => "test-agent" };
  assert.notEqual(visitorKey(req, "2026-10-02"), visitorKey(req, "2026-10-03"));
  assert.ok(
    !normalizeQuery("email me at person@example.test 9876543210").includes(
      "person@",
    ),
  );
});
