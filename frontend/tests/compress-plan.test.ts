import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLOOR,
  LEVELS,
  compressTarget,
  effectiveDpi,
  formatMB,
  levelSize,
  needsCompression,
  planBatches,
  renderScale,
} from "../src/lib/processing/compress-plan.ts";

const MB = 1024 * 1024;
const A4 = [595, 842] as const,
  A3_SPREAD = [1190, 842] as const;

test("only files over the limit are compressed", () => {
  assert.equal(needsCompression(20 * MB, 20 * MB), false);
  assert.equal(needsCompression(5 * MB, 20 * MB), false);
  assert.equal(needsCompression(20 * MB + 1, 20 * MB), true);
  assert.ok(compressTarget(20 * MB) < 20 * MB);
});

test("levels only ever get smaller and never go under the readability floor", () => {
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(LEVELS[i].dpi < LEVELS[i - 1].dpi);
    assert.ok(LEVELS[i].quality <= LEVELS[i - 1].quality);
  }
  assert.equal(FLOOR, LEVELS[LEVELS.length - 1]);
  assert.ok(FLOOR.dpi >= 130 && FLOOR.quality >= 0.65);
});

test("A4 pages and two-page spreads keep the full DPI at every level", () => {
  for (const [w, h] of [A4, A3_SPREAD])
    for (const level of LEVELS) {
      const size = levelSize(w, h, level);
      assert.ok(
        Math.abs(effectiveDpi(size.width, w) - level.dpi) < 1,
        `${w}x${h} at ${level.dpi} DPI`,
      );
    }
});

test("photos placed on huge pages are capped by pixels, not blown up by DPI", () => {
  const [w, h] = [3000, 4000];
  for (const level of LEVELS) {
    const size = levelSize(w, h, level);
    assert.ok(size.width * size.height <= level.maxPixels * 1.01);
  }
  // Even capped, a single sheet photographed on such a page stays well above the floor
  // once you consider that it fills the whole page (A4 at 3.5 MP ≈ 190 DPI).
  const floor = levelSize(w, h, FLOOR);
  assert.ok(floor.width * floor.height >= 3_000_000);
});

test("level sizes never upscale past what was rendered", () => {
  const rendered = levelSize(...A4, LEVELS[0]);
  assert.deepEqual(levelSize(...A4, LEVELS[0], rendered), rendered);
  const small = { width: 800, height: 1132 };
  const size = levelSize(...A4, LEVELS[1], small);
  assert.equal(size.width, 800);
  assert.ok(Math.abs(size.height - 1132) <= 1);
  assert.ok(Math.abs(renderScale(...A4) - 200 / 72) < 0.01);
});

test("batches stay under the request budget and keep file order", () => {
  assert.deepEqual(planBatches([19, 19, 19, 19, 19].map((n) => n * MB), 90 * MB), [
    [0, 1, 2, 3],
    [4],
  ]);
  assert.deepEqual(planBatches([1, 2, 3].map((n) => n * MB)), [[0, 1, 2]]);
  // A file bigger than the budget still goes, alone.
  assert.deepEqual(planBatches([95 * MB, 1 * MB], 90 * MB), [[0], [1]]);
  assert.deepEqual(planBatches([]), []);
});

test("sizes read naturally", () => {
  assert.equal(formatMB(20 * MB), "20 MB");
  assert.equal(formatMB(17.94 * MB), "17.9 MB");
});
