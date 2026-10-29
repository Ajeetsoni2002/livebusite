import { test } from "node:test";
import assert from "node:assert/strict";
import { toGray, type Box, type Img } from "../src/lib/processing/core.ts";
import {
  eraseRollNumber,
  findRollNumber,
  inkShare,
  INK_THRESHOLD,
  wordsFrom,
  type OcrWord,
} from "../src/lib/processing/rollnumber.ts";

// A 2000 x 2800 page: "Roll No. 2582300156" at the top right, the pages line below it.
const W = 2000,
  H = 2800;
const word = (
  text: string,
  x: number,
  y: number,
  width: number,
  confidence = 95,
) => ({ text, confidence, box: { x, y, width, height: 40 } }) satisfies OcrWord;
const header = (...roll: OcrWord[]) => [
  ...roll,
  word("Total", 150, 540, 110),
  word("No.", 270, 540, 70),
  word("of", 350, 540, 40),
  word("Questions", 400, 540, 200),
  word(":", 610, 540, 10),
  word("06]", 630, 540, 60),
  word("[Total", 1000, 540, 120),
  word("No.", 1130, 540, 70),
  word("of", 1210, 540, 40),
  word("Printed", 1260, 540, 150),
  word("Pages", 1420, 540, 120),
  word(":", 1550, 540, 10),
  word("04", 1570, 540, 50),
];
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const covers = (areas: Box[], b: Box) =>
  areas.some(
    (a) =>
      a.x <= b.x &&
      a.y <= b.y &&
      right(a) >= right(b) &&
      bottom(a) >= bottom(b),
  );
const touches = (areas: Box[], b: Box) =>
  areas.some(
    (a) =>
      a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y,
  );

test("the handwriting after 'Roll No.' is erased, the label and the next line are not", () => {
  const words = header(
    word("Roll", 1050, 420, 90),
    word("No.", 1150, 420, 70),
    word("2582300156", 1240, 400, 330, 12),
  );
  const match = findRollNumber(words, W, H)!;
  assert.ok(match);
  assert.ok(covers(match.erase, { x: 1240, y: 400, width: 330, height: 40 }));
  // A number written well above the line is caught too.
  assert.ok(covers(match.erase, { x: 1100, y: 300, width: 400, height: 40 }));
  // The label stays; only the last few pixels of "No." are taken, where strokes overlap.
  assert.ok(!touches(match.erase, { x: 1050, y: 420, width: 160, height: 40 }));
  for (const w of words.filter((w) => w.box.y === 540))
    assert.ok(!touches(match.erase, w.box), `kept ${w.text}`);
});

test("OCR misreads of the label are still recognised", () => {
  for (const [a, b] of [
    ["Rol1", "No."],
    ["Rell", "N0"],
    ["RollNo.", ""],
  ]) {
    const words = header(
      word(a, 1050, 420, 90),
      ...(b ? [word(b, 1150, 420, 70)] : []),
    );
    assert.ok(findRollNumber(words, W, H), `${a} ${b}`);
  }
});

test("without a readable label the pages line anchors the search", () => {
  const words = header(word("2282300212", 1150, 410, 330, 15));
  const match = findRollNumber(words, W, H)!;
  assert.ok(match);
  assert.ok(covers(match.erase, { x: 1150, y: 410, width: 330, height: 40 }));
  for (const w of words.filter((w) => w.box.y === 540))
    assert.ok(!touches(match.erase, w.box), `kept ${w.text}`);
  // "Total No. of Questions : 06]" on the left is not where the label is.
  assert.ok(Math.min(...match.erase.map((a) => a.x)) > 900);
});

test("a page without the exam header has nothing to erase", () => {
  assert.equal(
    findRollNumber(
      [word("CODING", 400, 100, 300), word("DECODING", 750, 100, 350)],
      W,
      H,
    ),
    null,
  );
});

test("erasing paints the area with the paper colour and leaves the rest", () => {
  const width = 200,
    height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(240);
  // Ink: a dark stroke inside the area, and one outside it.
  for (let x = 60; x < 140; x++) {
    const i = (50 * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 20;
  }
  const outside = (90 * width + 10) * 4;
  data[outside] = data[outside + 1] = data[outside + 2] = 20;
  const img: Img = { width, height, data };
  const match = {
    label: { x: 0, y: 40, width: 50, height: 20 },
    erase: [{ x: 50, y: 30, width: 120, height: 40 }],
  };
  assert.ok(inkShare(toGray(img), match) >= INK_THRESHOLD);
  const out = eraseRollNumber(img, match);
  assert.equal(out.data[(50 * width + 100) * 4], 240);
  assert.equal(out.data[outside], 20);
  assert.equal(inkShare(toGray(out), match), 0);
});

test("tesseract blocks flatten into words with boxes", () => {
  const words = wordsFrom([
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                {
                  text: "Roll",
                  confidence: 91,
                  bbox: { x0: 10, y0: 20, x1: 60, y1: 45 },
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(words, [
    {
      text: "Roll",
      confidence: 91,
      box: { x: 10, y: 20, width: 50, height: 25 },
    },
  ]);
});
