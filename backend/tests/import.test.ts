import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
test("inventory preserves every source and flags conflicting catalog links", async () => {
  const { buildInventory } = await import("../src/import/inventory.js");
  const data = await buildInventory(
    resolve(process.cwd(), process.cwd().endsWith("backend") ? ".." : "."),
  );
  assert.equal(data.sourceFileCount, 140);
  assert.equal(data.assets.length, 77);
  assert.equal(data.subjects.length, 38);
  assert.ok(
    data.assets.some((a) => a.conflicts.some((c) => c.includes("CSE-504"))),
  );
  assert.ok(
    data.assets.find((a) =>
      a.sources.some((s) => s.endsWith("CSE-102(2021-22).pdf")),
    )?.conflicts.length,
  );
  assert.equal(
    data.assets.reduce((n, a) => n + a.sources.length, 0),
    140,
  );
});
