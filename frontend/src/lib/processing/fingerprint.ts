import { api } from "../api";
import type { ContentItem } from "../types";
import {
  MAX_HASHED_PAGES,
  OCR_PAGES,
  OCR_SIDE,
  buildFingerprint,
  cellMeans,
  needsOcr,
  renderSize,
  type Fingerprint,
  type Similarity,
} from "../../../../backend/src/lib/fingerprint";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export type { Fingerprint } from "../../../../backend/src/lib/fingerprint";
export type DuplicateMatch = Similarity & {
  kind: "papers" | "notes";
  /** Share of this upload's content found in the item, as a whole percentage. */
  similarity: number;
  item: ContentItem;
};
export type DuplicateCheck = { matches: DuplicateMatch[]; threshold: number };
/** What the fingerprinting is doing, for progress text. */
export type FingerprintPhase = "pages" | "ocr";

// Text beyond this many pages adds little; the API's worker uses the same cut-off.
const MAX_TEXT_PAGES = 300;
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

async function renderTo(page: PDFPageProxy, side?: number) {
  const base = page.getViewport({ scale: 1 });
  const size = renderSize(base.width, base.height, side);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  await page.render({
    canvas,
    canvasContext: context,
    viewport: page.getViewport({ scale: size.scale }),
    background: "white",
  }).promise;
  return { canvas, context, size };
}

/**
 * Content fingerprint of a PDF, computed in the browser before it is uploaded (the API
 * recomputes it later from the stored file). Shares its algorithm with the server. A
 * scan without a text layer has its first pages read by OCR, so two different scans of
 * the same paper still compare on their words.
 */
export async function fingerprintPdf(
  bytes: Uint8Array,
  onProgress?: (done: number, total: number, phase: FingerprintPhase) => void,
): Promise<Fingerprint> {
  const { openPdf } = await import("./browser");
  const doc = await openPdf(bytes);
  try {
    const pages: (number[] | null)[] = [];
    const text: string[] = [];
    const total = Math.min(
      doc.numPages,
      Math.max(MAX_HASHED_PAGES, MAX_TEXT_PAGES),
    );
    for (let n = 1; n <= total; n++) {
      onProgress?.(n - 1, total, "pages");
      const page = await doc.getPage(n);
      try {
        if (n <= MAX_TEXT_PAGES)
          text.push(
            (await page.getTextContent()).items
              .map((item) => ("str" in item ? item.str : "") || "")
              .join(" "),
          );
        if (n > MAX_HASHED_PAGES) continue;
        try {
          const { context, size } = await renderTo(page);
          const image = context.getImageData(0, 0, size.width, size.height);
          pages.push(cellMeans(image.data, size.width, size.height));
        } catch {
          pages.push(null);
        }
      } finally {
        page.cleanup();
      }
      await yieldToUi();
    }
    const layer = text.join("\n");
    const ocr: string[] = [];
    if (needsOcr(layer)) {
      const { readPageText } = await import("./ocr");
      const count = Math.min(OCR_PAGES, doc.numPages);
      for (let n = 1; n <= count; n++) {
        onProgress?.(n - 1, count, "ocr");
        const page = await doc.getPage(n);
        try {
          const { canvas } = await renderTo(page, OCR_SIDE);
          ocr.push(await readPageText(canvas));
        } catch {
          // A page Tesseract cannot read just contributes no words.
        } finally {
          page.cleanup();
        }
        await yieldToUi();
      }
    }
    onProgress?.(total, total, "pages");
    return buildFingerprint(pages, layer, ocr.join("\n"));
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Library items of the same kind with overlapping content, best match first. */
export async function checkDuplicates(
  role: string,
  kind: string,
  fingerprint: Fingerprint,
  exclude?: string,
): Promise<DuplicateCheck> {
  const response = await api.post(
    `/${role}/duplicates/check`,
    { kind, fingerprint, ...(exclude ? { exclude } : {}) },
    { timeout: 60_000 },
  );
  return response.data.data as DuplicateCheck;
}

/** The server's duplicate refusal, when that is what an upload error was. */
export function duplicateDetails(error: unknown): DuplicateMatch[] | null {
  const body = (error as { response?: { data?: { error?: any } } })?.response
    ?.data?.error;
  return body?.code === "DUPLICATE_CONTENT" &&
    Array.isArray(body.details?.matches)
    ? (body.details.matches as DuplicateMatch[])
    : null;
}
