import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { PDFDocument, degrees } from "pdf-lib";
import type { Img, Preset } from "./core";
import {
  analyzeRaster,
  analyzeTextLayout,
  defaultDecision,
  partBoxes,
  processRaster,
  wantsEnhance,
  wantsSplit,
  type EnhanceMode,
  type PageDecision,
  type RasterAnalysis,
} from "./pipeline";

GlobalWorkerOptions.workerSrc = workerUrl;

/*
 * Browser side of the processing pipeline. Pages are handled one at a time (render →
 * analyse → clean → JPEG) so memory stays flat; only small JPEGs are kept.
 */
export const MAX_PAGES = 60;
const PREVIEW_WIDTH = 900;

export type PageInfo = {
  index: number;
  /** Size in PDF points as displayed (rotation applied). */
  width: number;
  height: number;
  bornDigital: boolean;
  /** PDF user-space origin of the page (mediabox may not start at 0,0). */
  origin: [number, number];
  raster?: RasterAnalysis;
  /** For born-digital pages: spread found from text positions. */
  textSpread?: RasterAnalysis["spread"];
  originalUrl: string;
};
export type OutputPart = {
  id: string;
  page: number;
  part: number;
  url: string;
  jpeg?: Blob;
  width: number;
  height: number;
  enhanced: boolean;
  split: boolean;
  /** Where this part sits on the original page (fractions), for the comparison view. */
  region: { x: number; y: number; w: number; h: number };
  /** Born-digital: crop box in PDF units (left, bottom, right, top) of the source page. */
  vector?: { left: number; bottom: number; right: number; top: number };
};
export type Settings = { mode: EnhanceMode; preset: Preset };

export async function openPdf(bytes: Uint8Array) {
  return getDocument({
    data: bytes.slice(),
    enableXfa: false,
    wasmUrl: "/pdfjs/wasm/",
  }).promise;
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
function toBlob(canvas: HTMLCanvasElement, quality = 0.8) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed"))),
      "image/jpeg",
      quality,
    ),
  );
}
function imgToCanvas(img: Img) {
  const canvas = canvasOf(img.width, img.height);
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
      0,
      0,
    );
  return canvas;
}
function scaled(canvas: HTMLCanvasElement, width: number) {
  if (canvas.width <= width) return canvas;
  const out = canvasOf(
    width,
    Math.round((canvas.height * width) / canvas.width),
  );
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  maxSide = 2200,
) {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / Math.max(base.width, base.height), 200 / 72);
  const viewport = page.getViewport({ scale });
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
  return { canvas, scale, base };
}

/** First pass: classify every page and keep a small preview of the original. */
export async function analyzeDocument(
  doc: PDFDocumentProxy,
  onProgress: (done: number, total: number) => void,
) {
  const pages: PageInfo[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    onProgress(i, doc.numPages);
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const items = (
      text.items as { str?: string; transform?: number[]; width?: number }[]
    )
      .filter((item) => item.str?.trim())
      .map((item) => ({ x: item.transform?.[4] ?? 0, width: item.width ?? 0 }));
    const chars = (text.items as { str?: string }[]).reduce(
      (n, item) => n + (item.str?.trim().length || 0),
      0,
    );
    // Real text means a born-digital page: never re-rendered, only watermarked.
    const bornDigital = chars > 80;
    const { canvas } = await renderPage(doc, i, bornDigital ? 1200 : 2200);
    const info: PageInfo = {
      index: i,
      width: base.width,
      height: base.height,
      bornDigital,
      origin: [page.view[0], page.view[1]],
      originalUrl: URL.createObjectURL(
        await toBlob(scaled(canvas, PREVIEW_WIDTH), 0.75),
      ),
    };
    // Vector cuts are only safe on unrotated pages; rotated ones are kept whole.
    if (bornDigital)
      info.textSpread =
        page.rotate % 360 === 0
          ? analyzeTextLayout(base.width, base.height, items)
          : {
              split: false,
              review: false,
              confidence: 0,
              at: 0.5,
              reason: "rotated page",
            };
    else {
      const ctx = canvas.getContext("2d")!;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      info.raster = analyzeRaster({
        width: data.width,
        height: data.height,
        data: data.data,
      });
    }
    pages.push(info);
    await yieldToUi();
  }
  onProgress(doc.numPages, doc.numPages);
  return pages;
}

/** Builds the output part(s) of one input page with the current decisions. */
export async function buildPage(
  doc: PDFDocumentProxy,
  info: PageInfo,
  decision: PageDecision,
  settings: Settings,
): Promise<OutputPart[]> {
  if (info.bornDigital) {
    const spread = info.textSpread!;
    const analysis = {
      box: { x: 0, y: 0, width: info.width, height: info.height },
      spread,
    };
    const split = wantsSplit(analysis, decision);
    const { canvas } = await renderPage(doc, info.index, 1400);
    const k = canvas.width / info.width;
    const parts: OutputPart[] = [];
    for (const [part, box] of partBoxes(analysis, decision).entries()) {
      const piece = canvasOf(
        Math.round(box.width * k),
        Math.round(box.height * k),
      );
      piece.getContext("2d")!.drawImage(canvas, -box.x * k, 0);
      // pdf.js boxes are top-left based; PDF crop boxes are bottom-left based.
      parts.push({
        id: `${info.index}:${part}`,
        page: info.index,
        part,
        url: URL.createObjectURL(
          await toBlob(scaled(piece, PREVIEW_WIDTH), 0.75),
        ),
        width: box.width,
        height: box.height,
        enhanced: false,
        split,
        region: {
          x: box.x / info.width,
          y: 0,
          w: box.width / info.width,
          h: 1,
        },
        vector: {
          left: info.origin[0] + box.x,
          bottom: info.origin[1],
          right: info.origin[0] + box.x + box.width,
          top: info.origin[1] + info.height,
        },
      });
    }
    return parts;
  }
  const { canvas } = await renderPage(doc, info.index);
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const img: Img = { width: data.width, height: data.height, data: data.data };
  const analysis = info.raster!;
  const split = wantsSplit(analysis, decision);
  const parts = processRaster(
    img,
    analysis,
    decision,
    settings.mode,
    settings.preset,
  );
  const regions = partBoxes(analysis, decision).map((box) => ({
    x: box.x / img.width,
    y: box.y / img.height,
    w: box.width / img.width,
    h: box.height / img.height,
  }));
  const out: OutputPart[] = [];
  for (const [part, result] of parts.entries()) {
    const full = imgToCanvas(result.img);
    const jpeg = await toBlob(full, 0.8);
    out.push({
      id: `${info.index}:${part}`,
      page: info.index,
      part,
      url: URL.createObjectURL(await toBlob(scaled(full, PREVIEW_WIDTH), 0.75)),
      jpeg,
      width: result.img.width,
      height: result.img.height,
      enhanced: result.enhanced,
      split,
      region: regions[part],
    });
    await yieldToUi();
  }
  return out;
}

export function releaseParts(parts: OutputPart[]) {
  for (const part of parts) URL.revokeObjectURL(part.url);
}

/** Fits an image page into A4 (portrait or landscape) keeping its proportions. */
function a4Fit(width: number, height: number) {
  const [boxW, boxH] = width > height ? [842, 595] : [595, 842];
  const scale = Math.min(boxW / width, boxH / height);
  return [width * scale, height * scale];
}

/** Assembles the processed PDF in the chosen page order. */
export async function assemblePdf(
  originalBytes: Uint8Array,
  parts: OutputPart[],
  decisions: PageDecision[],
  onProgress: (done: number, total: number) => void,
) {
  const out = await PDFDocument.create();
  const needsSource = parts.some((p) => p.vector);
  const source = needsSource
    ? await PDFDocument.load(originalBytes, { ignoreEncryption: false })
    : null;
  for (const [i, part] of parts.entries()) {
    onProgress(i, parts.length);
    const turns = decisions[part.page]?.turns || 0;
    if (part.vector && source) {
      const srcPage = source.getPage(part.page);
      if (!part.split) {
        const [copy] = await out.copyPages(source, [part.page]);
        out.addPage(copy);
        copy.setRotation(
          degrees((copy.getRotation().angle + turns * 90) % 360),
        );
        continue;
      }
      const embedded = await out.embedPage(srcPage, part.vector);
      const page = out.addPage([
        part.vector.right - part.vector.left,
        part.vector.top - part.vector.bottom,
      ]);
      page.drawPage(embedded, { x: 0, y: 0 });
      if (turns) page.setRotation(degrees(turns * 90));
      continue;
    }
    const image = await out.embedJpg(
      new Uint8Array(await part.jpeg!.arrayBuffer()),
    );
    const [w, h] = a4Fit(part.width, part.height);
    out.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    await yieldToUi();
  }
  onProgress(parts.length, parts.length);
  out.setProducer("BUIT Papers");
  return new Blob(
    [new Uint8Array(await out.save({ useObjectStreams: true }))],
    {
      type: "application/pdf",
    },
  );
}

export function reportOf(
  pages: PageInfo[],
  parts: OutputPart[],
  settings: Settings,
) {
  const split = [
    ...new Set(parts.filter((p) => p.split).map((p) => p.page + 1)),
  ];
  const enhanced = [
    ...new Set(parts.filter((p) => p.enhanced).map((p) => p.page + 1)),
  ];
  return {
    pages: parts.length,
    sourcePages: pages.length,
    split,
    enhanced,
    preset: settings.preset,
    mode: settings.mode,
  };
}

/** Whether automatic processing would change anything worth keeping. */
export function wouldChange(pages: PageInfo[], settings: Settings) {
  return pages.some((p) =>
    p.bornDigital
      ? p.textSpread?.split
      : p.raster &&
        (p.raster.spread.split ||
          wantsEnhance(p.raster, defaultDecision, settings.mode)),
  );
}

/** Headless run with automatic decisions (admin bulk processing). */
export async function autoProcess(
  bytes: Uint8Array,
  settings: Settings,
  onProgress: (label: string) => void,
) {
  const doc = await openPdf(bytes);
  try {
    if (doc.numPages > MAX_PAGES)
      return { skipped: `More than ${MAX_PAGES} pages` as const };
    const pages = await analyzeDocument(doc, (d, t) =>
      onProgress(`Analysing ${d}/${t}`),
    );
    if (!wouldChange(pages, settings)) {
      pages.forEach((p) => URL.revokeObjectURL(p.originalUrl));
      return { skipped: "Already clean" as const };
    }
    const decisions = pages.map(() => defaultDecision);
    const parts: OutputPart[] = [];
    for (const page of pages) {
      onProgress(`Processing ${page.index + 1}/${pages.length}`);
      parts.push(
        ...(await buildPage(doc, page, decisions[page.index], settings)),
      );
    }
    const blob = await assemblePdf(bytes, parts, decisions, () => {});
    const meta = reportOf(pages, parts, settings);
    releaseParts(parts);
    pages.forEach((p) => URL.revokeObjectURL(p.originalUrl));
    return { blob, meta };
  } finally {
    await doc.loadingTask.destroy();
  }
}
