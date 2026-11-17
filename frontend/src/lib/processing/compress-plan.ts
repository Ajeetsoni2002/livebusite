/*
 * Pure decisions for the oversize-PDF compressor (compress.ts does the rendering).
 * Kept free of DOM APIs so the readability rules can be unit-tested in Node.
 */

/** One quality step: page resolution in DPI, a pixel cap for oversized pages, JPEG quality. */
export type Level = { dpi: number; maxPixels: number; quality: number };

/*
 * Best first. The last step is the readability floor: 130 DPI keeps 9–10 pt print and
 * handwriting legible and JPEG 0.65 keeps text edges free of heavy blocking. Nothing
 * below it is ever tried; a PDF that still does not fit is refused, not degraded.
 * The pixel caps only matter for pages much larger than A4 (photos placed on huge pages):
 * an A3 two-page spread still gets the full DPI at every step.
 */
export const LEVELS: readonly Level[] = [
  { dpi: 200, maxPixels: 8_000_000, quality: 0.8 },
  { dpi: 170, maxPixels: 6_000_000, quality: 0.75 },
  { dpi: 150, maxPixels: 4_500_000, quality: 0.7 },
  { dpi: 130, maxPixels: 3_500_000, quality: 0.65 },
];
export const FLOOR = LEVELS[LEVELS.length - 1];

/** Larger scans take minutes in a browser tab; such files should be split instead. */
export const MAX_COMPRESS_PAGES = 300;

/** Used until the server says otherwise (matches the backend's MAX_UPLOAD_MB default). */
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Cloudflare rejects request bodies over 100 MB on the free plan, and every upload goes
 * through the Pages proxy; batches are split to stay well under it.
 */
export const MAX_REQUEST_BYTES = 90 * 1024 * 1024;

/** Aim a little under the server limit so a result is never rejected by a few bytes. */
export function compressTarget(limit: number) {
  return Math.floor(limit * 0.95);
}

/** Only files over the limit are touched; everything else is uploaded byte-for-byte. */
export function needsCompression(size: number, limit: number) {
  return size > limit;
}

/**
 * Pixel size of a page (given in PDF points, rotation applied) at a level. Never above
 * `rendered`, the size actually rendered, so nothing is upscaled.
 */
export function levelSize(
  widthPt: number,
  heightPt: number,
  level: Level,
  rendered?: { width: number; height: number },
) {
  const scale = Math.min(
    level.dpi / 72,
    Math.sqrt(level.maxPixels / Math.max(1, widthPt * heightPt)),
  );
  let width = Math.max(1, Math.round(widthPt * scale)),
    height = Math.max(1, Math.round(heightPt * scale));
  if (rendered && width > rendered.width) {
    height = Math.max(1, Math.round((height * rendered.width) / width));
    width = rendered.width;
  }
  return { width, height };
}

/** The render scale (pixels per point) that serves the best level without upscaling later. */
export function renderScale(widthPt: number, heightPt: number) {
  return levelSize(widthPt, heightPt, LEVELS[0]).width / Math.max(1, widthPt);
}

/** Effective DPI of a page drawn at `pixelWidth` across `widthPt` points. */
export function effectiveDpi(pixelWidth: number, widthPt: number) {
  return (pixelWidth / Math.max(1, widthPt)) * 72;
}

/**
 * Groups files (by index) into requests whose total stays under `budget`, keeping order.
 * A single file larger than the budget still gets its own request.
 */
export function planBatches(sizes: number[], budget = MAX_REQUEST_BYTES) {
  const batches: number[][] = [];
  let current: number[] = [],
    total = 0;
  sizes.forEach((size, index) => {
    if (current.length && total + size > budget) {
      batches.push(current);
      current = [];
      total = 0;
    }
    current.push(index);
    total += size;
  });
  if (current.length) batches.push(current);
  return batches;
}

export function formatMB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
