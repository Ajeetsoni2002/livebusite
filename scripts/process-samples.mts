// Runs the browser processing pipeline on real PDFs in Node and writes before/after images.
// Usage: node --import tsx scripts/process-samples.mts samples/*.pdf
import { readFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import {
  analyzeRaster,
  defaultDecision,
  processRaster,
  wantsEnhance,
} from "../frontend/src/lib/processing/pipeline.ts";
import type { Img } from "../frontend/src/lib/processing/core.ts";

const require = createRequire(import.meta.url);
const { getDocument } = await import(
  "file:///" +
    require.resolve("pdfjs-dist/legacy/build/pdf.mjs").replaceAll("\\", "/")
);
const out = "docs/processing";
mkdirSync(out, { recursive: true });
const jpeg = (img: Img, file: string, width = 900) =>
  sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .resize({ width: Math.min(width, img.width) })
    .jpeg({ quality: 72 })
    .toFile(file);

for (const path of process.argv.slice(2)) {
  const name = basename(path, ".pdf").replace(/[^a-zA-Z0-9-]+/g, "_");
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(path)),
    verbosity: 0,
  }).promise;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.length;
    const scale = Math.min(2200 / Math.max(base.width, base.height), 200 / 72);
    const vp = page.getViewport({ scale });
    const surface = doc.canvasFactory.create(
      Math.ceil(vp.width),
      Math.ceil(vp.height),
    );
    await page.render({
      canvasContext: surface.context,
      viewport: vp,
      background: "white",
    }).promise;
    const id = surface.context.getImageData(
      0,
      0,
      surface.canvas.width,
      surface.canvas.height,
    );
    doc.canvasFactory.destroy(surface);
    const img: Img = { width: id.width, height: id.height, data: id.data };
    let t = performance.now();
    const analysis = analyzeRaster(img);
    const analyzeMs = performance.now() - t;
    t = performance.now();
    const parts = processRaster(
      img,
      analysis,
      defaultDecision,
      "needed",
      "grayscale",
    );
    const processMs = performance.now() - t;
    await jpeg(img, `${out}/${name}-p${n}-before.jpg`);
    for (const [i, part] of parts.entries())
      await jpeg(
        part.img,
        `${out}/${name}-p${n}-after${parts.length > 1 ? "-" + "ab"[i] : ""}.jpg`,
        700,
      );
    console.log(
      `${name} p${n}: ${img.width}x${img.height} text:${text} photo:${analysis.photo.score.toFixed(2)} ` +
        `enhance:${wantsEnhance(analysis, defaultDecision, "needed")} spread:${analysis.spread.split ? "SPLIT" : analysis.spread.review ? "review" : "no"} ` +
        `conf:${analysis.spread.confidence.toFixed(2)} at:${analysis.spread.at.toFixed(2)} (${analysis.spread.reason}) ` +
        `box:${JSON.stringify(analysis.box)} parts:${parts.length} deskew:${parts.map((p) => p.deskew).join("/")} ` +
        `ms:${Math.round(analyzeMs)}+${Math.round(processMs)}`,
    );
  }
}
