import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import esbuild from "esbuild";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { computeFingerprint } from "../backend/src/processing/fingerprint.ts";
import {
  PAGE_MATCH_BITS,
  compareFingerprints,
  hamming,
} from "../backend/src/lib/fingerprint.ts";

/*
 * Checks that a fingerprint computed in Chrome (as the upload page does) matches the one
 * the API's worker computes for the same PDF: same page count, same text sketch, and
 * page hashes within a small fraction of the match tolerance. Run from the repo root:
 *   node --import tsx scripts/fingerprint-browser-smoke.mjs [more.pdf ...]
 */
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const samples = [
  resolve(root, "samples/BE 102.pdf"),
  resolve(root, "samples/CSE-702_ 2023_.pdf"),
  ...process.argv.slice(2).map((p) => resolve(p)),
];
// A typed document as well, so the text layer is compared too.
async function typedPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  for (let p = 0; p < 2; p++) {
    const page = pdf.addPage([595, 842]);
    for (let line = 0; line < 40; line++)
      page.drawText(
        `Question ${p * 40 + line + 1}. Explain the working of a ${["diode", "transistor", "amplifier", "oscillator"][line % 4]} with a neat diagram and derive its gain.`,
        { x: 40, y: 800 - line * 18, size: 9, font },
      );
  }
  return Buffer.from(await pdf.save());
}
const virtual = new Map([["/typed.pdf", await typedPdf()]]);
const shared = (
  await esbuild.transform(
    await readFile(resolve(root, "backend/src/lib/fingerprint.ts"), "utf8"),
    { loader: "ts", format: "esm" },
  )
).code;
virtual.set("/fingerprint.js", Buffer.from(shared));
virtual.set(
  "/index.html",
  Buffer.from(`<!doctype html><script type="module">
import { getDocument, GlobalWorkerOptions } from "/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { buildFingerprint, cellMeans, renderSize, MAX_HASHED_PAGES } from "/fingerprint.js";
GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";
// Mirrors frontend/src/lib/processing/fingerprint.ts.
window.fingerprint = async (url) => {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const doc = await getDocument({
    data: bytes,
    wasmUrl: "/node_modules/pdfjs-dist/wasm/",
    cMapUrl: "/node_modules/pdfjs-dist/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/node_modules/pdfjs-dist/standard_fonts/",
    enableXfa: false,
  }).promise;
  const pages = [], text = [];
  for (let n = 1; n <= Math.min(doc.numPages, 300); n++) {
    const page = await doc.getPage(n);
    text.push((await page.getTextContent()).items.map((i) => i.str || "").join(" "));
    if (n > MAX_HASHED_PAGES) continue;
    const base = page.getViewport({ scale: 1 });
    const size = renderSize(base.width, base.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: size.scale }), background: "white" }).promise;
    pages.push(cellMeans(context.getImageData(0, 0, size.width, size.height).data, size.width, size.height));
    page.cleanup();
  }
  await doc.loadingTask.destroy();
  return buildFingerprint(pages, text.join("\\n"));
};
window.ready = true;
</script>`),
);
const types = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".html": "text/html",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const body =
      virtual.get(path) ??
      (path.startsWith("/node_modules/") || path.startsWith("/samples/")
        ? await readFile(resolve(root, "." + path))
        : null);
    if (!body) throw new Error("not found");
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let i = 0;
for (const file of samples) {
  virtual.set(`/sample-${i}.pdf`, await readFile(file));
  i++;
}
// Playwright's own Chromium when it is installed, otherwise the machine's Chrome.
const browser = await chromium
  .launch()
  .catch(() => chromium.launch({ channel: "chrome" }));
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error", e.message));
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => window.ready);
  const cases = [
    ["typed.pdf", virtual.get("/typed.pdf")],
    ...samples.map((f, n) => [
      `sample-${n}.pdf`,
      virtual.get(`/sample-${n}.pdf`),
    ]),
  ];
  // Chrome and the server's canvas rasterise glyphs differently, so page hashes of
  // typed pages drift apart; those documents are compared on their text layer, which
  // must agree exactly. Scanned pages (images) must hash the same on both sides.
  let worstScan = 0;
  for (const [name, bytes] of cases) {
    const inBrowser = await page.evaluate(
      (url) => window.fingerprint(url),
      `/${name}`,
    );
    // Page hashes and the text layer are what must agree; OCR is a server-side extra here.
    const onServer = await computeFingerprint(bytes, { ocr: false });
    assert.equal(
      inBrowser.pages.length,
      onServer.pages.length,
      `${name}: page count`,
    );
    assert.deepEqual(inBrowser.text, onServer.text, `${name}: text sketch`);
    const distances = inBrowser.pages.map((hash, n) =>
      hamming(hash, onServer.pages[n]),
    );
    if (!onServer.text) worstScan = Math.max(worstScan, ...distances);
    const similarity = compareFingerprints(inBrowser, onServer);
    console.info(
      `${name}: ${onServer.pages.length} pages, text ${onServer.text ? "yes" : "no"}, per-page bits apart [${distances.join(", ")}], similarity ${Math.round(similarity.score * 100)}%`,
    );
    assert.equal(similarity.score, 1, `${name}: browser and server disagree`);
  }
  assert.ok(
    worstScan <= PAGE_MATCH_BITS / 4,
    `scanned page hashes differ by up to ${worstScan} bits between Chrome and the server; the match tolerance is ${PAGE_MATCH_BITS}`,
  );
  console.info(
    `Browser and server fingerprints agree (worst scanned page ${worstScan} bits apart of ${PAGE_MATCH_BITS} allowed).`,
  );
} finally {
  await browser.close();
  server.close();
}
