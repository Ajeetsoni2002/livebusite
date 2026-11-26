/*
 * Content fingerprints for duplicate detection. The browser computes one for a PDF
 * before uploading it and the API computes the same one in a background job, so the
 * two must agree bit for bit: this file has no DOM or Node imports and both sides
 * render pages at the size `renderSize` gives before calling `cellMeans`.
 *
 * A fingerprint has three independent parts:
 *   - pages: a perceptual hash of every rendered page (a 16×16 grid of grey levels,
 *     compared to its neighbours), which survives re-encoding, compression, cleaning
 *     and small crops of a scan;
 *   - text: a bottom-k sketch of the word 5-grams in the text layer, when the PDF has
 *     one (typed papers, Markdown notes), from which the share of shared text between
 *     two documents is estimated;
 *   - ocr: the same kind of sketch over word pairs, built from the text layer when
 *     there is one and otherwise from OCR of the first pages of a scan, so two
 *     different scans or photos of the same paper still compare on their words.
 * Two documents that both carry a text layer are compared on text alone: typed pages
 * laid out on the same template look alike at grid resolution, and browsers and the
 * server's canvas rasterise glyphs differently, so their page hashes of typed pages
 * drift apart (scanned pages, which are images, hash the same everywhere; see
 * scripts/fingerprint-browser-smoke.mjs).
 */
export const FINGERPRINT_VERSION = 2;
/** Page hash grid: GRID×GRID grey cells, 2·GRID·(GRID−1) gradient bits. */
export const GRID = 16;
export const PAGE_HASH_BITS = 2 * GRID * (GRID - 1);
export const PAGE_HASH_HEX = PAGE_HASH_BITS / 4;
/** Long side, in pixels, of a page render before hashing. */
export const RENDER_SIDE = 256;
/** Pages beyond this are not hashed (their text still counts). */
export const MAX_HASHED_PAGES = 150;
export const SKETCH_SIZE = 512;
const SHINGLE_WORDS = 5;
/** Below this many words a text layer says nothing reliable about the document. */
const MIN_TEXT_WORDS = 40;
/** Two page hashes within this many differing bits are the same page. */
export const PAGE_MATCH_BITS = 72;
/** A page whose grey cells barely vary (blank, or a flat photo) is skipped. */
const BLANK_PAGE_DEVIATION = 1.5;
/** At or above this share of shared content a new upload is refused as a copy. */
export const DUPLICATE_THRESHOLD = 0.8;
/** From this share the uploader is told about the similar item, without being blocked. */
export const SIMILAR_THRESHOLD = 0.5;
/** Scans without a text layer: pages read by OCR, and the render size they are read at. */
export const OCR_PAGES = 6;
export const OCR_SIDE = 2000;
/*
 * OCR misreads a few words per line, so its sketch uses word pairs, and even then two
 * scans of one paper share only part of them. Measured on the library's scans against
 * simulated re-scans (tilted, cropped, darker, blurred, re-compressed): pairs of the
 * same paper reached a Jaccard similarity of 0.12–0.68 (median 0.43), different
 * papers of the same subject at most 0.10. So 0.4 already means "the same paper" and
 * maps to a score of 1; 0.1 maps to 0.25, well under the warning level.
 */
const OCR_SHINGLE_WORDS = 2;
const MIN_OCR_WORDS = 30;
export const OCR_FULL_MATCH = 0.4;

export type TextSketch = {
  /** Characters of normalised text. */
  chars: number;
  /** Distinct word groups in the whole text. */
  shingles: number;
  /** The `SKETCH_SIZE` smallest shingle hashes, ascending (all of them when fewer). */
  sketch: number[];
};
export type Fingerprint = {
  v: number;
  /** One hex hash per rendered page; "" for a blank page. */
  pages: string[];
  text: TextSketch | null;
  /** Word-pair sketch of the text layer or, for a scan, of its OCR text. */
  ocr?: TextSketch | null;
};
/** Shingle hashes to leave out of a comparison: see `commonShingles`. */
export type Boilerplate = {
  text?: ReadonlySet<number>;
  ocr?: ReadonlySet<number>;
};
export type Similarity = {
  /** Share of the candidate's content found in the other document, 0–1. */
  score: number;
  basis: "text" | "ocr" | "pages" | "none";
  /** Pages of the candidate that matched a page of the other document. */
  matchedPages?: number;
};

/** Pixel size both sides render a page at: long side `side`, whole pixels. */
export function renderSize(width: number, height: number, side = RENDER_SIDE) {
  const scale = side / Math.max(width, height);
  return {
    scale,
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale)),
  };
}

/** Mean luminance of each GRID×GRID cell of an RGBA image, row-major. */
export function cellMeans(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): number[] {
  const cells: number[] = new Array(GRID * GRID).fill(0);
  for (let row = 0; row < GRID; row++) {
    const y0 = Math.floor((row * height) / GRID);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / GRID));
    for (let col = 0; col < GRID; col++) {
      const x0 = Math.floor((col * width) / GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / GRID));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4)
          // Integer luma (Rec. 601) keeps the value identical on every platform.
          sum += (rgba[i] * 77 + rgba[i + 1] * 151 + rgba[i + 2] * 28) >> 8;
      }
      cells[row * GRID + col] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return cells;
}

/** Gradient hash of a page's cell means as hex; "" when the page is blank. */
export function pageHash(cells: number[]): string {
  const n = cells.length;
  const mean = cells.reduce((a, b) => a + b, 0) / n;
  const deviation = Math.sqrt(
    cells.reduce((a, b) => a + (b - mean) ** 2, 0) / n,
  );
  if (deviation < BLANK_PAGE_DEVIATION) return "";
  const bits: number[] = [];
  for (let row = 0; row < GRID; row++)
    for (let col = 0; col < GRID - 1; col++)
      bits.push(cells[row * GRID + col] < cells[row * GRID + col + 1] ? 1 : 0);
  for (let col = 0; col < GRID; col++)
    for (let row = 0; row < GRID - 1; row++)
      bits.push(
        cells[row * GRID + col] < cells[(row + 1) * GRID + col] ? 1 : 0,
      );
  let hex = "";
  for (let i = 0; i < bits.length; i += 4)
    hex += (
      (bits[i] << 3) |
      (bits[i + 1] << 2) |
      (bits[i + 2] << 1) |
      bits[i + 3]
    ).toString(16);
  return hex;
}

const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
/** Differing bits between two page hashes (unequal lengths count as all different). */
export function hamming(a: string, b: string) {
  if (a.length !== b.length) return PAGE_HASH_BITS;
  let bits = 0;
  for (let i = 0; i < a.length; i++)
    bits += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return bits;
}

/** Normalised words of a text: lower case, letters and digits only. */
export function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}
/** FNV-1a, 32 bits: small, fast and identical in every JavaScript engine. */
export function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
function sketchOf(list: string[], groupWords: number): TextSketch {
  const hashes = new Set<number>();
  for (let i = 0; i + groupWords <= list.length; i++)
    hashes.add(fnv1a(list.slice(i, i + groupWords).join(" ")));
  const sorted = [...hashes].sort((a, b) => a - b);
  return {
    chars: list.join(" ").length,
    shingles: sorted.length,
    sketch: sorted.slice(0, SKETCH_SIZE),
  };
}
/** Bottom-k sketch of a text's word 5-grams; null when there is too little text. */
export function textSketch(text: string): TextSketch | null {
  const list = words(text);
  return list.length < MIN_TEXT_WORDS ? null : sketchOf(list, SHINGLE_WORDS);
}
/**
 * Sketch for OCR-grade comparisons: word pairs, single characters dropped (OCR turns
 * noise into stray letters). The same function serves text layers, so a scan can be
 * compared with a typed copy of the same paper.
 */
export function ocrSketch(text: string): TextSketch | null {
  const list = words(text).filter((word) => word.length > 1);
  return list.length < MIN_OCR_WORDS ? null : sketchOf(list, OCR_SHINGLE_WORDS);
}

/**
 * Word groups that appear in many documents of a library say nothing about whether
 * two of them are the same paper: every question paper of one university carries the
 * same printed header and instructions. Returns the hashes found in at least
 * `share` of the sketches (and in at least `minDocs` of them).
 */
export function commonShingles(
  sketches: (TextSketch | null | undefined)[],
  share = 0.15,
  minDocs = 5,
): Set<number> {
  const counts = new Map<number, number>();
  let documents = 0;
  for (const sketch of sketches) {
    if (!sketch?.sketch.length) continue;
    documents++;
    for (const hash of sketch.sketch)
      counts.set(hash, (counts.get(hash) || 0) + 1);
  }
  const needed = Math.max(minDocs, Math.ceil(documents * share));
  const common = new Set<number>();
  for (const [hash, count] of counts) if (count >= needed) common.add(hash);
  return common;
}
/** A sketch sorted and stripped of boilerplate, ready for many comparisons. */
type PreparedSketch = { sketch: number[]; shingles: number };
/** Page hashes as nibble arrays, so comparing them is a table lookup per character. */
type PreparedPage = Uint8Array;
export type Prepared = {
  text: PreparedSketch | null;
  ocr: PreparedSketch | null;
  pages: PreparedPage[];
};
function prepareSketch(
  sketch: TextSketch | null | undefined,
  ignore?: ReadonlySet<number>,
): PreparedSketch | null {
  if (!sketch?.sketch.length) return null;
  const kept = ignore?.size
    ? sketch.sketch.filter((hash) => !ignore.has(hash))
    : sketch.sketch;
  if (!kept.length) return null;
  return {
    sketch: [...kept].sort((x, y) => x - y),
    // The share dropped from the sample estimates the share dropped from the set.
    shingles: Math.round(
      (sketch.shingles * kept.length) / sketch.sketch.length,
    ),
  };
}
/**
 * Does the one-off work of a comparison (sorting, boilerplate removal, hex parsing)
 * so a document can be compared with the whole library cheaply.
 */
export function prepare(
  fingerprint: Fingerprint,
  boilerplate: Boilerplate = {},
): Prepared {
  return {
    text: prepareSketch(fingerprint.text, boilerplate.text),
    ocr: prepareSketch(fingerprint.ocr, boilerplate.ocr),
    pages: fingerprint.pages
      .filter(Boolean)
      .map((hash) => Uint8Array.from(hash, (c) => parseInt(c, 16))),
  };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
function sketchSimilarity(a: PreparedSketch, b: PreparedSketch) {
  const k = Math.min(a.sketch.length, b.sketch.length);
  // The k smallest hashes of the union are a uniform sample of it: walk both sorted
  // lists together and count the sampled hashes that sit in both.
  let i = 0,
    j = 0,
    taken = 0,
    shared = 0;
  while (taken < k) {
    const x = a.sketch[i],
      y = b.sketch[j];
    if (x === undefined && y === undefined) break;
    if (y === undefined || x < y) i++;
    else if (x === undefined || y < x) j++;
    else {
      shared++;
      i++;
      j++;
    }
    taken++;
  }
  const jaccard = shared / k;
  const unionSize = (a.shingles + b.shingles) / (1 + jaccard);
  const intersection = jaccard * unionSize;
  return {
    jaccard: clamp(jaccard),
    aInB: clamp(intersection / a.shingles),
    bInA: clamp(intersection / b.shingles),
  };
}
/**
 * Jaccard similarity of two shingle sets from their bottom-k sketches, and the share
 * of each set contained in the other (derived from the set sizes). Hashes in `ignore`
 * (boilerplate shared across the library) are left out on both sides.
 */
export function textSimilarity(
  a: TextSketch,
  b: TextSketch,
  ignore?: ReadonlySet<number>,
) {
  const pa = prepareSketch(a, ignore),
    pb = prepareSketch(b, ignore);
  if (!pa || !pb) return { jaccard: 0, aInB: 0, bInA: 0 };
  return sketchSimilarity(pa, pb);
}

function nibbleDistance(a: PreparedPage, b: PreparedPage) {
  if (a.length !== b.length) return PAGE_HASH_BITS;
  let bits = 0;
  for (let i = 0; i < a.length; i++) bits += POPCOUNT[a[i] ^ b[i]];
  return bits;
}
function preparedPageSimilarity(
  pagesA: PreparedPage[],
  pagesB: PreparedPage[],
) {
  if (!pagesA.length || !pagesB.length) return null;
  const used = new Set<number>();
  let matched = 0;
  for (const hash of pagesA) {
    let best = -1,
      bestBits = PAGE_MATCH_BITS + 1;
    for (let j = 0; j < pagesB.length; j++) {
      if (used.has(j)) continue;
      const bits = nibbleDistance(hash, pagesB[j]);
      if (bits < bestBits) {
        bestBits = bits;
        best = j;
      }
    }
    if (best >= 0) {
      used.add(best);
      matched++;
    }
  }
  return {
    matched,
    aInB: matched / pagesA.length,
    bInA: matched / pagesB.length,
    jaccard: matched / (pagesA.length + pagesB.length - matched),
  };
}
/** Pages of `a` that have a matching page in `b` (each page of `b` used once). */
export function pageSimilarity(a: string[], b: string[]) {
  const toNibbles = (hashes: string[]) =>
    hashes
      .filter(Boolean)
      .map((hash) => Uint8Array.from(hash, (c) => parseInt(c, 16)));
  return preparedPageSimilarity(toNibbles(a), toNibbles(b));
}

/** How much of the prepared `candidate` is already in the prepared `existing`. */
export function comparePrepared(
  candidate: Prepared,
  existing: Prepared,
): Similarity {
  if (candidate.text && existing.text) {
    const t = sketchSimilarity(candidate.text, existing.text);
    return { score: Math.max(t.jaccard, t.aInB), basis: "text" };
  }
  let best: Similarity = { score: 0, basis: "none" };
  const p = preparedPageSimilarity(candidate.pages, existing.pages);
  if (p)
    best = {
      score: Math.max(p.jaccard, p.aInB),
      basis: "pages",
      matchedPages: p.matched,
    };
  if (candidate.ocr && existing.ocr) {
    const o = sketchSimilarity(candidate.ocr, existing.ocr);
    // Only the first pages of a scan are read, so when one text is much longer the
    // containment of the shorter one is the fairer measure; it must hold both ways
    // for a tiny text not to "match" everything.
    const raw = Math.max(o.jaccard, Math.min(o.aInB, o.bInA));
    const score = Math.min(1, raw / OCR_FULL_MATCH);
    if (score > best.score) best = { score, basis: "ocr" };
  }
  return best;
}
/** How much of `candidate` is already in `existing`. */
export function compareFingerprints(
  candidate: Fingerprint,
  existing: Fingerprint,
  boilerplate: Boilerplate = {},
): Similarity {
  return comparePrepared(
    prepare(candidate, boilerplate),
    prepare(existing, boilerplate),
  );
}

/** Symmetric view of a pair, for the admin report: the smaller document inside the larger. */
export function pairPrepared(a: Prepared, b: Prepared): Similarity {
  const ab = comparePrepared(a, b),
    ba = comparePrepared(b, a);
  return ab.score >= ba.score ? ab : ba;
}
export function pairSimilarity(
  a: Fingerprint,
  b: Fingerprint,
  boilerplate: Boilerplate = {},
): Similarity {
  return pairPrepared(prepare(a, boilerplate), prepare(b, boilerplate));
}

/** Whether a document's text layer is too thin to compare on, so its scan needs OCR. */
export const needsOcr = (text: string) => textSketch(text) === null;

/**
 * Builds a fingerprint from rendered pages (null = not rendered), the text layer and,
 * for a scan, the OCR text of its first pages.
 */
export function buildFingerprint(
  pages: (number[] | null)[],
  text: string,
  ocrText = "",
): Fingerprint {
  const layer = textSketch(text);
  return {
    v: FINGERPRINT_VERSION,
    pages: pages
      .slice(0, MAX_HASHED_PAGES)
      .map((cells) => (cells ? pageHash(cells) : "")),
    text: layer,
    ocr: ocrSketch(layer ? text : ocrText),
  };
}

/** Fingerprint of a Markdown note: text only. */
export function markdownFingerprint(markdown: string): Fingerprint {
  return {
    v: FINGERPRINT_VERSION,
    pages: [],
    text: textSketch(markdown),
    ocr: ocrSketch(markdown),
  };
}

export const percent = (score: number) => Math.round(score * 100);
