import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

// stdout carries only the image, never PDF.js diagnostics or document content.
console.log = console.warn = () => {};
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const resourceDir = (name) => join(pdfjsRoot, name).replaceAll("\\", "/") + "/";
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error("PDF exceeds thumbnail limit");
    chunks.push(chunk);
  }
  const loading = getDocument({
    data: new Uint8Array(Buffer.concat(chunks)),
    cMapUrl: resourceDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: resourceDir("standard_fonts"),
    wasmUrl: resourceDir("wasm"),
    verbosity: 0,
    isEvalSupported: false,
    enableXfa: false,
    maxImageSize: 16_000_000,
    stopAtErrors: true,
    useSystemFonts: false,
  });
  try {
    const document = await loading.promise;
    const page = await document.getPage(1);
    const original = page.getViewport({ scale: 1 });
    if (
      ![original.width, original.height].every(
        (n) => Number.isFinite(n) && n > 0,
      )
    )
      throw new Error("Invalid page size");
    const viewport = page.getViewport({
      scale: Math.min(1, 480 / Math.max(original.width, original.height)),
    });
    const surface = document.canvasFactory.create(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    try {
      await page.render({
        canvasContext: surface.context,
        viewport,
        background: "white",
      }).promise;
      const image = await sharp(surface.canvas.toBuffer("image/png"))
        .webp({ quality: 78 })
        .toBuffer();
      if (image.length > 512 * 1024) throw new Error("Thumbnail exceeds limit");
      process.stdout.write(image);
    } finally {
      document.canvasFactory.destroy(surface);
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
} catch {
  process.exitCode = 1;
}
