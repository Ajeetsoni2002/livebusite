// Child process: stdin = PDF bytes, argv[2] = JSON options, stdout = JSON with the grey
// cell means of every rendered page, the document's text layer and, for a scan without
// one, the OCR text of its first pages. Hashing happens in the parent with the shared
// algorithm, so the browser and the API cannot drift apart.
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  cellMeans,
  MAX_HASHED_PAGES,
  needsOcr,
  OCR_PAGES,
  OCR_SIDE,
  renderSize,
} from "../lib/fingerprint.js";

// stdout carries the result only; pdf.js and Tesseract diagnostics are dropped.
console.log = console.warn = console.error = () => {};
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const resource = (name) => join(pdfjsRoot, name).replaceAll("\\", "/") + "/";
const options = JSON.parse(process.argv[2] || "{}");
const maxPages = Number(options.maxPages) || MAX_HASHED_PAGES;
// Text beyond this many pages adds little and keeps long notes quick to scan.
const maxTextPages = Number(options.maxTextPages) || 300;

async function render(document, page, side) {
  const base = page.getViewport({ scale: 1 });
  if (![base.width, base.height].every((v) => Number.isFinite(v) && v > 0))
    return null;
  const size = renderSize(base.width, base.height, side);
  const viewport = page.getViewport({ scale: size.scale });
  const surface = document.canvasFactory.create(size.width, size.height);
  try {
    await page.render({
      canvasContext: surface.context,
      viewport,
      background: "white",
    }).promise;
    return { surface, size };
  } catch {
    document.canvasFactory.destroy(surface);
    return null;
  }
}

/** Reads the first pages of a scan with Tesseract (language data is cached on disk). */
async function readScan(document) {
  const { createWorker } = await import("tesseract.js");
  if (options.ocrCacheDir)
    await mkdir(options.ocrCacheDir, { recursive: true });
  const worker = await createWorker("eng", 1, {
    cachePath: options.ocrCacheDir,
    logger: () => {},
    errorHandler: () => {},
  });
  const text = [];
  try {
    for (let n = 1; n <= Math.min(OCR_PAGES, document.numPages); n++) {
      const page = await document.getPage(n);
      try {
        const rendered = await render(document, page, OCR_SIDE);
        if (!rendered) continue;
        try {
          const image = rendered.surface.canvas.toBuffer("image/png");
          text.push((await worker.recognize(image)).data.text);
        } finally {
          document.canvasFactory.destroy(rendered.surface);
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await worker.terminate();
  }
  return text.join("\n");
}

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const loading = getDocument({
    data: new Uint8Array(Buffer.concat(chunks)),
    cMapUrl: resource("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: resource("standard_fonts"),
    wasmUrl: resource("wasm"),
    verbosity: 0,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
  });
  try {
    const document = await loading.promise;
    const pages = [];
    const text = [];
    for (let n = 1; n <= document.numPages; n++) {
      if (n > maxPages && n > maxTextPages) break;
      const page = await document.getPage(n);
      try {
        if (n <= maxTextPages)
          text.push(
            (await page.getTextContent()).items
              .map((item) => item.str || "")
              .join(" "),
          );
        if (n > maxPages) continue;
        const rendered = await render(document, page);
        if (!rendered) {
          pages.push(null);
          continue;
        }
        try {
          const image = rendered.surface.context.getImageData(
            0,
            0,
            rendered.size.width,
            rendered.size.height,
          );
          pages.push(
            cellMeans(image.data, rendered.size.width, rendered.size.height),
          );
        } finally {
          document.canvasFactory.destroy(rendered.surface);
        }
      } finally {
        page.cleanup();
      }
    }
    const layer = text.join("\n");
    const ocr = options.ocr && needsOcr(layer) ? await readScan(document) : "";
    process.stdout.write(
      JSON.stringify({ pageCount: document.numPages, pages, text: layer, ocr }),
    );
  } finally {
    await loading.destroy();
  }
} catch (error) {
  process.stderr.write(String(error?.message || error).slice(0, 300));
  process.exitCode = 1;
}
