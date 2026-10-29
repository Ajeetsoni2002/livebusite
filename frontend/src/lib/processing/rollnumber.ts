import type { Box, Gray, Img } from "./core";

/**
 * Exam papers print "Roll No. ........" at the top right and students write their roll
 * number on that line. OCR finds the printed label (or the "[Total No. of Printed
 * Pages" line just below it); the handwriting is painted over with the paper colour,
 * stopping above the next printed line.
 */
export type OcrWord = { text: string; confidence: number; box: Box };
export type RollMatch = {
  /** The printed "Roll No." label, or where it is expected. */
  label: Box;
  /** Areas painted over (rendered pixels). */
  erase: Box[];
};
/** OCR reads only this top share of page 1; the roll number line is always in it. */
export const OCR_TOP = 0.4;

type TesseractBlocks = {
  paragraphs: {
    lines: {
      words: {
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }[];
    }[];
  }[];
}[];
/** Flattens tesseract.js `blocks` output into words with boxes. */
export function wordsFrom(blocks: TesseractBlocks | null | undefined) {
  const words: OcrWord[] = [];
  for (const block of blocks || [])
    for (const paragraph of block.paragraphs)
      for (const line of paragraph.lines)
        for (const w of line.words)
          words.push({
            text: w.text,
            confidence: w.confidence,
            box: {
              x: w.bbox.x0,
              y: w.bbox.y0,
              width: w.bbox.x1 - w.bbox.x0,
              height: w.bbox.y1 - w.bbox.y0,
            },
          });
  return words;
}

const ROLL = /^[[(|]?r[o0e][l1i|!]{1,2}[.,:]?$/i;
const NUMBER_LABEL = /^n[o0][.,:;]*$/i;
const ROLL_NO = /^r[o0e][l1i|!]{1,2}[.,]?n[o0][.,:;]*/i;
// Handwritten digits read as garbage, so only real words count as printed.
const PRINTED = /[a-z]{3,}|\]|\[/i;

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const sameLine = (a: Box, b: Box) =>
  Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) >
  0.4 * Math.min(a.height, b.height);

/** The printed "Roll No." label in the right part of the top of the page. */
function findLabel(words: OcrWord[], width: number, height: number) {
  const labels: Box[] = [];
  for (const [i, word] of words.entries()) {
    const text = word.text.trim();
    if (word.box.y > height * 0.4 || word.box.height < 4) continue;
    if (ROLL_NO.test(text)) {
      labels.push(word.box);
      continue;
    }
    if (!ROLL.test(text)) continue;
    // "No." is normally the next word on the same line, a short gap away.
    const next = words
      .slice(i + 1, i + 4)
      .find(
        (w) =>
          NUMBER_LABEL.test(w.text.trim()) &&
          sameLine(w.box, word.box) &&
          w.box.x - right(word.box) < word.box.height * 2.5,
      );
    labels.push(
      next
        ? {
            x: word.box.x,
            y: Math.min(word.box.y, next.box.y),
            width: right(next.box) - word.box.x,
            height:
              Math.max(bottom(word.box), bottom(next.box)) -
              Math.min(word.box.y, next.box.y),
          }
        : // Without "No." assume its usual width (about 0.9 of "Roll").
          { ...word.box, width: word.box.width * 1.9 },
    );
  }
  return labels.filter((b) => b.x > width * 0.3).sort((a, b) => a.y - b.y)[0];
}

/**
 * Finds where the handwritten roll number sits among OCR words of the top of page 1.
 * `width`/`height` are the page size in pixels.
 */
export function findRollNumber(
  words: OcrWord[],
  width: number,
  height: number,
): RollMatch | null {
  const label = findLabel(words, width, height);
  if (label) {
    const h = label.height;
    const x = Math.max(0, Math.round(right(label) - 0.15 * h));
    // Handwriting often climbs well above the dotted line, rarely far below it.
    const y = Math.max(0, Math.round(label.y - 6 * h));
    let end = Math.min(height, bottom(label) + 0.7 * h);
    const erase = {
      x,
      y,
      width: Math.round(Math.min(width - x, width * 0.5)),
      height: 0,
    };
    // Stop above the next printed line ("[Total No. of Printed Pages : 04").
    for (const w of words)
      if (
        !sameLine(w.box, label) &&
        w.box.y > bottom(label) &&
        w.confidence >= 55 &&
        PRINTED.test(w.text) &&
        w.box.x < right(erase) &&
        right(w.box) > erase.x
      )
        end = Math.min(end, w.box.y - 0.2 * h);
    erase.height = Math.max(0, Math.round(end - y));
    // Numbers written high above the line can start over "Roll No."; the label stays.
    const above = {
      x: Math.max(0, Math.round(label.x - h)),
      y,
      width: right(erase) - Math.max(0, Math.round(label.x - h)),
      height: Math.max(0, Math.round(label.y - 0.15 * h - y)),
    };
    return { label, erase: [erase, above] };
  }
  // OCR misses "Roll No." on faint or overwritten scans, but reliably reads the
  // "[Total No. of Printed Pages" line printed just below it.
  const pages = words.find(
    (w) =>
      /print/i.test(w.text) && w.box.x > width * 0.3 && w.box.y < height * 0.4,
  );
  if (!pages) return null;
  const h = pages.box.height;
  // Walk left over "[Total No. of" and stop there, never into "Questions : 6]".
  let start = pages.box.x;
  for (const w of words
    .filter((w) => sameLine(w.box, pages.box) && w.box.x < pages.box.x)
    .sort((a, b) => b.box.x - a.box.x)) {
    if (start - right(w.box) > 1.2 * h || /\]$/.test(w.text)) break;
    start = w.box.x;
    if (/^[[(|{]|total/i.test(w.text)) break;
  }
  // The label goes too: the number may start under "No." or sit high above the line,
  // up to the first clearly printed word above.
  const x = Math.max(0, Math.round(start - h));
  let y = Math.max(0, Math.round(pages.box.y - 12 * h));
  for (const w of words)
    if (
      bottom(w.box) < pages.box.y - 3 * h &&
      w.confidence >= 80 &&
      /[a-z]{4,}/i.test(w.text) &&
      w.box.x < x + width * 0.55 &&
      right(w.box) > x
    )
      y = Math.max(y, Math.round(bottom(w.box) + 0.2 * h));
  const erase = {
    x,
    y,
    width: Math.round(Math.min(width - x, width * 0.55)),
    height: Math.round(pages.box.y - 0.25 * h - y),
  };
  if (erase.height < h) return null;
  return {
    label: {
      x: start,
      y: Math.round(pages.box.y - 2.5 * h),
      width: Math.round(3.3 * h),
      height: h,
    },
    erase: [erase],
  };
}

function inside(x: number, y: number, b: Box) {
  return x >= b.x && x < right(b) && y >= b.y && y < bottom(b);
}

/** Share of dark pixels in the erase area; a blank area (no line, no number) is ~0. */
export function inkShare(gray: Gray, match: RollMatch) {
  let dark = 0,
    total = 0;
  for (const area of match.erase)
    for (let y = area.y; y < Math.min(gray.height, bottom(area)); y++)
      for (let x = area.x; x < Math.min(gray.width, right(area)); x++) {
        total++;
        if (gray.data[y * gray.width + x] < 110) dark++;
      }
  return total ? dark / total : 0;
}
// Erasing an empty line is harmless, missing a number is not: only skip a blank area.
export const INK_THRESHOLD = 0.003;

/** Paints the erase area with the surrounding paper colour. */
export function eraseRollNumber(img: Img, match: RollMatch): Img {
  const data = new Uint8ClampedArray(img.data);
  for (const area of match.erase) {
    const [r, g, b] = paperColour(img, area);
    for (let y = area.y; y < Math.min(img.height, bottom(area)); y++)
      for (let x = area.x; x < Math.min(img.width, right(area)); x++) {
        const i = (y * img.width + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
  }
  return { ...img, data };
}

/** Median colour of a ring around the box: the paper, not the ink. */
function paperColour(img: Img, box: Box): [number, number, number] {
  const ring = 12;
  const samples: [number, number, number][] = [];
  for (let y = box.y - ring; y < bottom(box) + ring; y += 2)
    for (let x = box.x - ring; x < right(box) + ring; x += 2) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      if (inside(x, y, box)) continue;
      const i = (y * img.width + x) * 4;
      samples.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  if (!samples.length) return [255, 255, 255];
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return samples[Math.floor(samples.length / 2)];
}
