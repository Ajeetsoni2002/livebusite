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
test("visitor city and IP are trusted only when the Pages proxy vouches for them", async () => {
  process.env.CF_ORIGIN_SECRET ||= "proxy-secret-for-tests";
  const { config } = await import("../src/config.js");
  config.cfOriginSecret = "proxy-secret-for-tests";
  const { clientInfo, visitorKey } =
    await import("../src/modules/analytics.js");
  const request = (headers: Record<string, string>): any => ({
    ip: "10.0.0.1",
    get: (name: string) =>
      Object.entries(headers).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      )?.[1],
  });
  const visitor = {
    "User-Agent": "test-agent",
    "X-Visitor-IP": "203.0.113.7",
    "X-Visitor-Country": "IN",
    "X-Visitor-Region": "Madhya%20Pradesh",
    "X-Visitor-City": "Bhopal",
  };
  const trusted = request({
    ...visitor,
    "X-Origin-Verify": "proxy-secret-for-tests",
  });
  assert.deepEqual(
    (({ country, region, city }) => ({ country, region, city }))(
      clientInfo(trusted),
    ),
    { country: "IN", region: "Madhya Pradesh", city: "Bhopal" },
  );
  const forged = request({ ...visitor, "X-Origin-Verify": "guess" });
  assert.equal(clientInfo(forged).city, undefined);
  assert.equal(clientInfo(forged).country, "Unknown");
  // Two visitors behind the same proxy address still count as two people.
  const other = request({
    ...visitor,
    "X-Origin-Verify": "proxy-secret-for-tests",
    "X-Visitor-IP": "203.0.113.8",
  });
  assert.notEqual(
    visitorKey(trusted, "2026-11-03"),
    visitorKey(other, "2026-11-03"),
  );
});
