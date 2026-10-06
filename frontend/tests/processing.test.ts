import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentBox,
  detectSpread,
  enhance,
  estimateSkew,
  normalize,
  photoScore,
  rotate,
  toGray,
  type Img,
} from "../src/lib/processing/core.ts";
import {
  analyzeRaster,
  analyzeTextLayout,
  defaultDecision,
  processRaster,
  wantsEnhance,
} from "../src/lib/processing/pipeline.ts";

// Deterministic "text": rows of word-like bars inside the given columns.
function page(
  width: number,
  height: number,
  columns: [number, number][],
  extra: (img: Img) => void = () => {},
): Img {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ink = (x: number, y: number, v = 30) => {
    const o = (y * width + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = v;
  };
  for (const [x0, x1] of columns)
    for (let y = 60; y < height - 60; y += 26) {
      let x = x0;
      while (x < x1) {
        const len = 18 + Math.floor(rand() * 45);
        for (let dx = 0; dx < len && x + dx < x1; dx++)
          for (let dy = 0; dy < 9; dy++) ink(x + dx, y + dy);
        x += len + 10;
      }
    }
  const img = { width, height, data };
  extra(img);
  return img;
}
const spreadOf = (img: Img) => detectSpread(normalize(toGray(img)));

test("a single portrait page is never split", () => {
  const result = spreadOf(page(600, 850, [[60, 540]]));
  assert.equal(result.split, false);
  assert.equal(result.review, false);
});

test("a two-page spread with an empty gutter is split near the middle", () => {
  const result = spreadOf(
    page(1200, 850, [
      [60, 540],
      [660, 1140],
    ]),
  );
  assert.equal(result.split, true, result.reason);
  assert.ok(Math.abs(result.at - 0.5) < 0.03, `split at ${result.at}`);
  assert.ok(result.confidence >= 0.7);
});

test("a spread with a dark fold line and a narrow gutter is still split", () => {
  const img = page(
    1200,
    850,
    [
      [60, 575],
      [625, 1140],
    ],
    (img) => {
      for (let y = 0; y < img.height; y++)
        for (let x = 598; x < 602; x++) {
          const o = (y * img.width + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 20;
        }
    },
  );
  const result = spreadOf(img);
  assert.equal(result.split, true, result.reason);
  assert.ok(Math.abs(result.at - 0.5) < 0.03);
});

test("a genuine landscape page with text across the middle is not split", () => {
  const result = spreadOf(page(1200, 850, [[60, 1140]]));
  assert.equal(result.split, false);
  assert.equal(result.review, false);
});

test("a landscape table with a centred column gap but ruled rows is not split", () => {
  const img = page(
    1200,
    850,
    [
      [60, 560],
      [640, 1140],
    ],
    (img) => {
      for (let y = 70; y < img.height - 60; y += 52)
        for (let x = 40; x < 1160; x++) {
          const o = (y * img.width + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 40;
        }
    },
  );
  assert.equal(spreadOf(img).split, false);
});

function asPhoto(img: Img): Img {
  // Uneven lamp light from the left, warm cast, greyish paper.
  const data = new Uint8ClampedArray(img.data);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const light = 0.55 + 0.4 * (x / img.width) + 0.05 * (y / img.height);
      const o = (y * img.width + x) * 4;
      data[o] = data[o] * light;
      data[o + 1] = data[o + 1] * light * 0.95;
      data[o + 2] = data[o + 2] * light * 0.82;
    }
  return { ...img, data };
}

test("photo-likeness separates phone photos from clean scans", () => {
  const clean = page(600, 850, [[60, 540]]);
  assert.ok(photoScore(clean).score < 0.2, `clean ${photoScore(clean).score}`);
  const photo = asPhoto(clean);
  assert.ok(
    photoScore(photo).score >= 0.45,
    `photo ${photoScore(photo).score}`,
  );
  // Clean scans are left untouched in "only needed" mode.
  assert.equal(
    wantsEnhance(analyzeRaster(clean), defaultDecision, "needed"),
    false,
  );
  assert.equal(
    wantsEnhance(analyzeRaster(photo), defaultDecision, "needed"),
    true,
  );
});

test("grayscale cleanup whitens uneven paper and keeps text dark", () => {
  const photo = asPhoto(page(600, 850, [[60, 540]]));
  const out = toGray(enhance(photo, "grayscale"));
  let paper = 0,
    papers = 0,
    text = 0,
    texts = 0;
  const original = toGray(page(600, 850, [[60, 540]]));
  for (let i = 0; i < out.data.length; i++)
    if (original.data[i] > 200) {
      paper += out.data[i];
      papers++;
    } else {
      text += out.data[i];
      texts++;
    }
  assert.ok(paper / papers > 240, `paper ${paper / papers}`);
  assert.ok(text / texts < 90, `text ${text / texts}`);
});

test("skew is measured and corrected", () => {
  const straight = page(700, 900, [[60, 640]]);
  assert.equal(estimateSkew(normalize(toGray(straight))), 0);
  const tilted = rotate(straight, 2);
  const measured = estimateSkew(normalize(toGray(tilted)));
  assert.ok(Math.abs(Math.abs(measured) - 2) <= 0.4, `measured ${measured}`);
  const [part] = processRaster(
    asPhoto(tilted),
    analyzeRaster(asPhoto(tilted)),
    { ...defaultDecision, enhance: "on" },
    "needed",
    "grayscale",
  );
  assert.ok(Math.abs(part.deskew) > 1.5);
  assert.ok(Math.abs(estimateSkew(normalize(toGray(part.img)))) <= 0.4);
});

test("a photo placed on a white page is cropped to the photo", () => {
  const sheet = page(400, 300, [[30, 370]]);
  const data = new Uint8ClampedArray(600 * 800 * 4).fill(255);
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 400; x++) {
      const s = (y * 400 + x) * 4,
        d = ((y + 250) * 600 + x + 100) * 4;
      for (let c = 0; c < 3; c++)
        data[d + c] = Math.min(230, sheet.data[s + c]);
    }
  const box = contentBox(toGray({ width: 600, height: 800, data }));
  assert.ok(
    Math.abs(box.x - 100) <= 3 && Math.abs(box.y - 250) <= 3,
    JSON.stringify(box),
  );
  assert.ok(Math.abs(box.width - 400) <= 6 && Math.abs(box.height - 300) <= 6);
});

test("processing a spread yields two halves in reading order; overrides are respected", () => {
  const spread = page(1200, 850, [
    [60, 540],
    [660, 1140],
  ]);
  const analysis = analyzeRaster(spread);
  const parts = processRaster(
    spread,
    analysis,
    defaultDecision,
    "none",
    "grayscale",
  );
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts[0].img.width - parts[1].img.width) < 20);
  const left = toGray(parts[0].img);
  // The left half holds the left column (ink near its left edge).
  let ink = 0;
  for (let y = 0; y < left.height; y++)
    if (left.data[y * left.width + 70] < 100) ink++;
  assert.ok(ink > 20);
  assert.equal(
    processRaster(
      spread,
      analysis,
      { ...defaultDecision, split: "off" },
      "none",
      "grayscale",
    ).length,
    1,
  );
  const turned = processRaster(
    spread,
    analysis,
    { ...defaultDecision, turns: 1 },
    "none",
    "grayscale",
  );
  assert.equal(turned[0].img.width, parts[0].img.height);
});

test("born-digital spreads are found from text positions", () => {
  const item = (x: number) => ({ x, width: 40 });
  const two = [50, 120, 200, 300, 450, 500, 560, 620, 700, 760].map(item);
  assert.equal(analyzeTextLayout(842, 595, two).split, true);
  const across = [...two, { x: 330, width: 200 }];
  assert.equal(analyzeTextLayout(842, 595, across).split, false);
  assert.equal(analyzeTextLayout(595, 842, two).split, false);
});
