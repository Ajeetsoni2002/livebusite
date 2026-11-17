import { PDFDocument } from "pdf-lib";
import { openPdf } from "./browser";
import {
  FLOOR,
  LEVELS,
  MAX_COMPRESS_PAGES,
  compressTarget,
  effectiveDpi,
  formatMB,
  levelSize,
  needsCompression,
  renderScale,
} from "./compress-plan";

/*
 * Shrinks a PDF that is over the upload limit, in the browser, so the free API never
 * holds or re-encodes large files. Steps, stopping at the first result that fits:
 *   1. lossless re-save (drops unused objects, packs the rest);
 *   2. scanned pages re-encoded at falling quality, text pages copied untouched;
 *   3. only if still too big: text pages rendered as images as well.
 * No step goes below the readability floor in compress-plan.ts; past it the file is
 * refused with a clear message instead of being made illegible.
 */

export type FitResult = {
  file: File;
  compressed: boolean;
  before: number;
  after: number;
  /** Lowest effective DPI of a re-encoded page, when pages were re-encoded. */
  dpi?: number;
  /** Text pages were turned into images: their text is no longer selectable. */
  textRasterized: boolean;
};

export class CompressionError extends Error {}

type PageData = {
  widthPt: number;
  heightPt: number;
  /** Real text on the page (same rule as the processing studio). */
  bornDigital: boolean;
  /** One JPEG per entry of LEVELS. */
  jpegs: Blob[];
  pixelWidths: number[];
};

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function resized(source: HTMLCanvasElement, width: number, height: number) {
  if (source.width === width && source.height === height) return source;
  const out = canvasOf(width, height);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return out;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed"))),
      "image/jpeg",
      quality,
    ),
  );
}

async function readPages(
  bytes: Uint8Array,
  onProgress: (label: string) => void,
) {
  const doc = await openPdf(bytes);
  try {
    if (doc.numPages > MAX_COMPRESS_PAGES)
      throw new CompressionError(
        `This PDF has ${doc.numPages} pages; automatic compression handles up to ${MAX_COMPRESS_PAGES}. Split it into smaller parts and upload them separately.`,
      );
    const pages: PageData[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      onProgress(`compressing page ${i + 1} of ${doc.numPages}…`);
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const chars = (text.items as { str?: string }[]).reduce(
        (n, item) => n + (item.str?.trim().length || 0),
        0,
      );
      const viewport = page.getViewport({
        scale: renderScale(base.width, base.height),
      });
      const canvas = canvasOf(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
        background: "white",
      }).promise;
      page.cleanup();
      const rendered = { width: canvas.width, height: canvas.height };
      const jpegs: Blob[] = [],
        pixelWidths: number[] = [];
      for (const level of LEVELS) {
        const size = levelSize(base.width, base.height, level, rendered);
        jpegs.push(
          await toJpeg(resized(canvas, size.width, size.height), level.quality),
        );
        pixelWidths.push(size.width);
      }
      // Release the full-size bitmap now rather than at garbage collection.
      canvas.width = canvas.height = 0;
      pages.push({
        widthPt: base.width,
        heightPt: base.height,
        bornDigital: chars > 80,
        jpegs,
        pixelWidths,
      });
      await yieldToUi();
    }
    return pages;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Builds one candidate: chosen pages as JPEGs at `level`, text pages copied if kept. */
async function assemble(
  pages: PageData[],
  level: number,
  source: PDFDocument | null,
) {
  const out = await PDFDocument.create();
  const vectorPages = source
    ? pages.flatMap((page, i) => (page.bornDigital ? [i] : []))
    : [];
  // One copy call so fonts and images shared between pages are copied once.
  const copied = vectorPages.length
    ? await out.copyPages(source!, vectorPages)
    : [];
  const vectors = new Map(vectorPages.map((index, k) => [index, copied[k]]));
  for (const [i, page] of pages.entries()) {
    const vector = vectors.get(i);
    if (vector) {
      out.addPage(vector);
      continue;
    }
    const image = await out.embedJpg(
      new Uint8Array(await page.jpegs[level].arrayBuffer()),
    );
    // Same page size as the original, so the compressed copy looks the same.
    out.addPage([page.widthPt, page.heightPt]).drawImage(image, {
      x: 0,
      y: 0,
      width: page.widthPt,
      height: page.heightPt,
    });
  }
  out.setProducer("BUIT Papers");
  return out.save({ useObjectStreams: true });
}

export async function fitPdf(
  file: File,
  limit: number,
  onProgress: (label: string) => void = () => {},
): Promise<FitResult> {
  const before = file.size;
  if (!needsCompression(before, limit))
    return { file, compressed: false, before, after: before, textRasterized: false };
  const target = compressTarget(limit);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const done = (
    out: Uint8Array,
    extra: Pick<FitResult, "dpi" | "textRasterized">,
  ): FitResult => ({
    file: new File([out], file.name, { type: "application/pdf" }),
    compressed: true,
    before,
    after: out.length,
    ...extra,
  });

  onProgress("optimising the PDF structure…");
  // pdf-lib refuses encrypted or damaged files; then every page is re-drawn instead.
  let source: PDFDocument | null = null;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
    const resaved = await source.save({ useObjectStreams: true });
    if (resaved.length <= target)
      return done(resaved, { textRasterized: false });
  } catch {
    source = null;
  }

  const pages = await readPages(bytes, onProgress);
  const hasText = pages.some((p) => p.bornDigital),
    hasScans = pages.some((p) => !p.bornDigital);
  const sum = (level: number, onlyScans: boolean) =>
    pages.reduce(
      (n, p) => n + (onlyScans && p.bornDigital ? 0 : p.jpegs[level].size),
      0,
    );
  const lowestDpi = (level: number, onlyScans: boolean) =>
    Math.round(
      Math.min(
        ...pages
          .filter((p) => !(onlyScans && p.bornDigital))
          .map((p) => effectiveDpi(p.pixelWidths[level], p.widthPt)),
      ),
    );
  // Text pages stay as text while that can fit; turning them into images is the last resort.
  // (A text-only PDF with text kept is exactly the lossless re-save that already failed.)
  const plans = [
    ...(source && hasText && hasScans
      ? LEVELS.map((_, level) => ({ level, keepText: true }))
      : []),
    ...LEVELS.map((_, level) => ({ level, keepText: false })),
  ];
  let smallest = Infinity;
  for (const { level, keepText } of plans) {
    // The images alone already exceed the target: assembling cannot help.
    const floor = sum(level, keepText);
    if (floor > target) {
      smallest = Math.min(smallest, floor);
      continue;
    }
    onProgress(
      `trying ${LEVELS[level].dpi} DPI${keepText ? "" : " (all pages as images)"}…`,
    );
    const out = await assemble(pages, level, keepText ? source : null);
    smallest = Math.min(smallest, out.length);
    if (out.length <= target)
      return done(out, {
        dpi: lowestDpi(level, keepText),
        textRasterized: hasText && !keepText,
      });
    await yieldToUi();
  }
  throw new CompressionError(
    `${file.name} is ${formatMB(before)}. At the lowest quality that still stays readable (about ${FLOOR.dpi} DPI) it would be ${formatMB(smallest)}, above the ${formatMB(limit)} limit. Split the PDF into two or more parts and upload them separately.`,
  );
}
