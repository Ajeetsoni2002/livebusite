import {
  contentBox,
  crop,
  detectSpread,
  enhance,
  estimateSkew,
  normalize,
  paperBox,
  photoScore,
  rotate,
  rotateQuarter,
  toGray,
  type Box,
  type Img,
  type Preset,
  type SpreadResult,
} from "./core";

/** Per input page: what the user (or "auto") decided. */
export type PageDecision = {
  split: "auto" | "on" | "off";
  /** Split position as a fraction of the content width (0.2..0.8). */
  splitAt?: number;
  enhance: "auto" | "on" | "off";
  /** Clockwise quarter turns applied to every output part of this page. */
  turns: 0 | 1 | 2 | 3;
};
export const defaultDecision: PageDecision = {
  split: "auto",
  enhance: "auto",
  turns: 0,
};
export type EnhanceMode = "needed" | "all" | "none";

export type RasterAnalysis = {
  box: Box;
  photo: ReturnType<typeof photoScore>;
  spread: SpreadResult;
};
export const PHOTO_THRESHOLD = 0.45;

/** Looks at a rendered image page: where the sheet is, photo-likeness, two-page spread. */
export function analyzeRaster(img: Img): RasterAnalysis {
  const gray = toGray(img);
  const outer = contentBox(gray);
  const inner = paperBox(crop(gray, outer));
  const box = {
    x: outer.x + inner.x,
    y: outer.y + inner.y,
    width: inner.width,
    height: inner.height,
  };
  const sheet = crop(gray, box);
  return {
    box,
    photo: photoScore(crop(img, box), sheet),
    spread: detectSpread(normalize(sheet)),
  };
}

export function wantsSplit(
  analysis: { spread: SpreadResult },
  d: PageDecision,
) {
  return d.split === "on" || (d.split === "auto" && analysis.spread.split);
}
export function wantsEnhance(
  analysis: RasterAnalysis,
  d: PageDecision,
  mode: EnhanceMode,
) {
  if (d.enhance !== "auto") return d.enhance === "on";
  return (
    mode === "all" ||
    (mode === "needed" && analysis.photo.score >= PHOTO_THRESHOLD)
  );
}

/** Boxes (in rendered pixels) of the one or two output pages for this input page. */
export function partBoxes(
  analysis: { box: Box; spread: SpreadResult },
  d: PageDecision,
) {
  const { box } = analysis;
  if (!wantsSplit(analysis, d)) return [box];
  const at = Math.min(0.8, Math.max(0.2, d.splitAt ?? analysis.spread.at));
  const cut = Math.round(box.width * at),
    margin = Math.round(box.width * 0.004);
  return [
    { x: box.x, y: box.y, width: cut - margin, height: box.height },
    {
      x: box.x + cut + margin,
      y: box.y,
      width: box.width - cut - margin,
      height: box.height,
    },
  ];
}

export type RasterPart = { img: Img; enhanced: boolean; deskew: number };

/** Produces the cleaned output image(s) for a rendered image page. */
export function processRaster(
  img: Img,
  analysis: RasterAnalysis,
  d: PageDecision,
  mode: EnhanceMode,
  preset: Preset,
): RasterPart[] {
  const enhanceOn = wantsEnhance(analysis, d, mode);
  return partBoxes(analysis, d).map((box) => {
    let part = crop(img, box),
      deskew = 0;
    if (enhanceOn) {
      // Each half of a photographed spread can show its own strip of table/background.
      part = crop(part, paperBox(toGray(part)));
      deskew = estimateSkew(normalize(toGray(part)));
      if (deskew) part = rotate(part, -deskew);
      part = enhance(part, preset);
    }
    return { img: rotateQuarter(part, d.turns), enhanced: enhanceOn, deskew };
  });
}

/**
 * Born-digital pages are never re-rendered: split decisions come from text positions so
 * the halves can be cut as vectors and stay selectable.
 */
export function analyzeTextLayout(
  pageWidth: number,
  pageHeight: number,
  items: { x: number; width: number }[],
): SpreadResult {
  const none: SpreadResult = {
    split: false,
    review: false,
    confidence: 0,
    at: 0.5,
    reason: "single page",
  };
  const aspect = pageWidth / pageHeight;
  if (aspect < 1.15 || items.length < 6) return none;
  const bins = 200,
    cover = new Uint16Array(bins);
  for (const item of items) {
    const a = Math.max(0, Math.floor((item.x / pageWidth) * bins));
    const b = Math.min(
      bins - 1,
      Math.floor(((item.x + Math.max(1, item.width)) / pageWidth) * bins),
    );
    for (let i = a; i <= b; i++) cover[i]++;
  }
  const left = cover.slice(10, 80).some(Boolean),
    right = cover.slice(120, 190).some(Boolean);
  if (!left || !right) return { ...none, reason: "one side is empty" };
  let best = 0,
    bestStart = -1;
  for (let i = 70, start = -1; i <= 130; i++) {
    const empty = i < 130 && cover[i] === 0;
    if (empty && start < 0) start = i;
    if (!empty && start >= 0) {
      if (i - start > best) {
        best = i - start;
        bestStart = start;
      }
      start = -1;
    }
  }
  if (best < 3) return { ...none, reason: "text crosses the middle" };
  const at = (bestStart + best / 2) / bins;
  const confidence = Math.min(
    1,
    0.4 * Math.min(1, (aspect - 1.15) / 0.25) +
      0.35 * Math.min(1, best / 8) +
      0.25 * Math.max(0, 1 - Math.abs(at - 0.5) / 0.15),
  );
  return {
    split: confidence >= 0.7,
    review: confidence >= 0.45 && confidence < 0.7,
    confidence,
    at,
    reason: "empty text gutter",
  };
}
