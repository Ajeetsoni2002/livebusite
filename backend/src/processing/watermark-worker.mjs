// Child process: stdin = PDF bytes, argv[2] = JSON options, stdout = watermarked PDF.
// Exit 3 (no output) when the PDF already carries the watermark text.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

console.log = console.warn = () => {};
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const resource = (name) => join(pdfjsRoot, name).replaceAll("\\", "/") + "/";
const options = JSON.parse(process.argv[2] || "{}");
const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

async function alreadyMarked(bytes) {
  const needle = normalize(options.skipIfContains || "");
  if (!needle) return false;
  const loading = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: resource("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: resource("standard_fonts"),
    wasmUrl: resource("wasm"),
    verbosity: 0,
    enableXfa: false,
    useSystemFonts: false,
  });
  try {
    const document = await loading.promise;
    for (let n = 1; n <= Math.min(2, document.numPages); n++) {
      const page = await document.getPage(n);
      const text = (await page.getTextContent()).items
        .map((item) => item.str || "")
        .join(" ");
      page.cleanup();
      if (normalize(text).includes(needle)) return true;
    }
    return false;
  } finally {
    await loading.destroy();
  }
}

async function watermark(bytes) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  if (String(pdf.getKeywords() || "").includes("buit-watermark")) return null;
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const text = options.text;
  const angle = Number(options.angle ?? 35);
  for (const page of pdf.getPages()) {
    const box = page.getCropBox();
    const W = box.width,
      H = box.height;
    const R = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    // Work in "visual" coordinates (what the reader sees), then map to page space.
    const vw = R % 180 ? H : W,
      vh = R % 180 ? W : H;
    const toPage = (vx, vy) =>
      R === 90
        ? [box.x + W - vy, box.y + vx]
        : R === 180
          ? [box.x + W - vx, box.y + H - vy]
          : R === 270
            ? [box.x + vy, box.y + H - vx]
            : [box.x + vx, box.y + vy];
    const scale = Math.max(0.4, Math.min(3, vw / 595));
    const size = Number(options.fontSize ?? 34) * scale;
    const width = bold.widthOfTextAtSize(text, size);
    const draw = (vx, vy, font, fontSize, opacity, color, rotate) => {
      const [x, y] = toPage(vx, vy);
      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees(rotate + R),
      });
    };
    const ink = rgb(0.12, 0.25, 0.45);
    const opacity = Number(options.opacity ?? 0.08);
    const rad = (angle * Math.PI) / 180;
    if (options.tiled !== false) {
      const stepX = width + size * 4,
        stepY = size * 6;
      let row = 0;
      for (let y = -vh; y < vh * 2; y += stepY, row++)
        for (let x = -vw + (row % 2) * (stepX / 2); x < vw * 2; x += stepX) {
          // Keep only stamps whose middle lands on the page.
          const mx = x + (Math.cos(rad) * width) / 2,
            my = y + (Math.sin(rad) * width) / 2;
          if (mx > -size && mx < vw + size && my > -size && my < vh + size)
            draw(x, y, bold, size, opacity, ink, angle);
        }
    } else {
      draw(
        vw / 2 - (Math.cos(rad) * width) / 2,
        vh / 2 - (Math.sin(rad) * width) / 2,
        bold,
        size,
        opacity * 1.5,
        ink,
        angle,
      );
    }
    if (options.footer !== false) {
      const footSize = Math.max(6, Math.min(18, 7 * scale));
      const footWidth = regular.widthOfTextAtSize(text, footSize);
      draw(
        (vw - footWidth) / 2,
        Math.max(4, 6 * scale),
        regular,
        footSize,
        0.55,
        rgb(0.35, 0.38, 0.45),
        0,
      );
    }
  }
  const keywords = String(pdf.getKeywords() || "");
  pdf.setKeywords([keywords, "buit-watermark"].filter(Boolean));
  pdf.setProducer("BUIT Papers");
  if (options.title) pdf.setTitle(options.title);
  pdf.setModificationDate(new Date());
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  if (!options.text) throw new Error("Missing watermark text");
  if (await alreadyMarked(bytes)) process.exitCode = 3;
  else {
    const output = await watermark(bytes);
    if (!output) process.exitCode = 3;
    else process.stdout.write(output);
  }
} catch (error) {
  process.stderr.write(String(error?.message || error).slice(0, 300));
  process.exitCode = 1;
}
