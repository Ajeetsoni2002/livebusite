// Child process: stdin = PDF bytes, argv[2] = JSON options, stdout = watermarked PDF.
// Exit 3 (no output) when the PDF already carries both the watermark and the site link.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFDocument, PDFString, StandardFonts, degrees, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

console.log = console.warn = () => {};
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const resource = (name) => join(pdfjsRoot, name).replaceAll("\\", "/") + "/";
const options = JSON.parse(process.argv[2] || "{}");
const normalize = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();
const pdfjsOptions = (bytes) => ({
  data: new Uint8Array(bytes),
  cMapUrl: resource("cmaps"),
  cMapPacked: true,
  standardFontDataUrl: resource("standard_fonts"),
  wasmUrl: resource("wasm"),
  verbosity: 0,
  isEvalSupported: false,
  enableXfa: false,
  useSystemFonts: false,
});
// Deterministic per-page jitter, so no two pages carry an identical overlay to diff out.
const jitter = (seed) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

async function alreadyMarked(bytes) {
  const needle = normalize(options.skipIfContains || "");
  if (!needle) return false;
  const loading = getDocument(pdfjsOptions(bytes));
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

/** The clickable site link, drawn over the strip at the top of a page. */
function addSiteLink(pdf, page, rect) {
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(options.siteLink.url),
      },
    }),
  );
  page.node.addAnnot(annotation);
}

function setMetadata(pdf, marks, stamp, link, burned) {
  pdf.setKeywords(
    [
      marks,
      stamp && "buit-watermark",
      link && "buit-sitelink",
      burned && "buit-burned",
    ].filter(Boolean),
  );
  if (link)
    pdf.setSubject(`${options.siteLink.label} - ${options.siteLink.url}`);
  pdf.setProducer("BUIT Papers");
  if (options.title) pdf.setTitle(options.title);
  pdf.setModificationDate(new Date());
}

/*
 * Stage 1: vector stamp. Draws the watermark, footer and site strip as text, like a
 * normal PDF watermark. Returns the bytes plus, for every page, the site strip's box in
 * visual coordinates (what the reader sees, origin bottom-left) for stage 2.
 */
async function stampVector(bytes, stamp, burn) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const marks = String(pdf.getKeywords() || "");
  stamp &&= !marks.includes("buit-watermark");
  // The site link is added even to PDFs that already carry a watermark, so every copy leads back.
  const link = options.siteLink?.url && !marks.includes("buit-sitelink");
  if (!stamp && !link) return null;
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const text = options.text || "";
  const angle = Number(options.angle ?? 35);
  const linkRects = [];
  pdf.getPages().forEach((page, index) => {
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
    // Burned pages are JPEG-compressed, where a very faint stamp would vanish.
    let opacity = Number(options.opacity ?? 0.08);
    if (burn)
      opacity = Math.max(opacity, 0.1) * (0.9 + jitter(index + 1) * 0.3);
    const rad = (angle * Math.PI) / 180;
    if (stamp && options.tiled !== false) {
      const stepX = width + size * 4,
        stepY = size * 6;
      const shiftX = burn ? jitter(index + 7) * stepX : 0,
        shiftY = burn ? jitter(index + 13) * stepY : 0;
      let row = 0;
      for (let y = -vh - shiftY; y < vh * 2; y += stepY, row++)
        for (
          let x = -vw - shiftX + (row % 2) * (stepX / 2);
          x < vw * 2;
          x += stepX
        ) {
          // Keep only stamps whose middle lands on the page.
          const mx = x + (Math.cos(rad) * width) / 2,
            my = y + (Math.sin(rad) * width) / 2;
          if (mx > -size && mx < vw + size && my > -size && my < vh + size)
            draw(x, y, bold, size, opacity, ink, angle);
        }
    } else if (stamp) {
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
    if (stamp && options.footer !== false) {
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
    if (link) {
      const label = `${options.siteLink.label} | ${options.siteLink.host}`;
      const linkSize = Math.max(8, Math.min(24, 10 * scale));
      const linkWidth = bold.widthOfTextAtSize(label, linkSize);
      const pad = linkSize * 0.45;
      const vx = (vw - linkWidth) / 2,
        vy = vh - Math.max(6, 8 * scale) - linkSize;
      // A light strip keeps the line readable on dark or busy photo scans.
      const [bx, by] = toPage(vx - pad, vy - pad * 0.8);
      page.drawRectangle({
        x: bx,
        y: by,
        width: linkWidth + pad * 2,
        height: linkSize + pad * 1.6,
        color: rgb(1, 1, 1),
        opacity: 0.85,
        rotate: degrees(R),
      });
      const [x, y] = toPage(vx, vy);
      page.drawText(label, {
        x,
        y,
        size: linkSize,
        font: bold,
        color: rgb(0.06, 0.3, 0.7),
        rotate: degrees(R),
      });
      const visual = [
        vx - pad,
        vy - pad * 0.8,
        vx + linkWidth + pad,
        vy + linkSize + pad * 0.8,
      ];
      linkRects.push(visual);
      // Clickable area over the line, in page space (annotations ignore page rotation).
      const corners = [
        toPage(visual[0], visual[1]),
        toPage(visual[2], visual[3]),
      ];
      addSiteLink(pdf, page, [
        Math.min(corners[0][0], corners[1][0]),
        Math.min(corners[0][1], corners[1][1]),
        Math.max(corners[0][0], corners[1][0]),
        Math.max(corners[0][1], corners[1][1]),
      ]);
    } else linkRects.push(null);
  });
  setMetadata(pdf, marks, stamp, link, false);
  return {
    bytes: Buffer.from(await pdf.save({ useObjectStreams: true })),
    stamp,
    link,
    marks,
    linkRects,
  };
}

/*
 * Stage 2: burn. Every page of the stamped PDF is rendered to an image, lightly
 * noised and stored as a JPEG page, so the watermark is part of the page pixels: there
 * is no separate text, layer or annotation that a PDF editor or "watermark remover"
 * can delete, and no exact overlay to subtract. The cost is that text can no longer be
 * selected or searched, which scanned papers never offered anyway.
 */
async function burn(stamped) {
  const loading = getDocument(pdfjsOptions(stamped.bytes));
  try {
    const document = await loading.promise;
    const pages = document.numPages;
    // Pixel budget by page count, so long notes stay within memory and size limits.
    const longSide = pages <= 12 ? 1800 : pages <= 40 ? 1500 : 1240;
    const quality = pages <= 12 ? 78 : 72;
    const out = await PDFDocument.create();
    for (let n = 1; n <= pages; n++) {
      const page = await document.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (![base.width, base.height].every((v) => Number.isFinite(v) && v > 0))
        throw new Error("Invalid page size");
      const viewport = page.getViewport({
        scale: longSide / Math.max(base.width, base.height),
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
        addNoise(
          surface.context,
          surface.canvas.width,
          surface.canvas.height,
          n,
        );
        const jpeg = surface.canvas.toBuffer("image/jpeg", quality);
        const image = await out.embedJpg(jpeg);
        // The page keeps its visual size in points; rotation is baked into the image.
        const target = out.addPage([base.width, base.height]);
        target.drawImage(image, {
          x: 0,
          y: 0,
          width: base.width,
          height: base.height,
        });
        const rect = stamped.linkRects[n - 1];
        if (rect) addSiteLink(out, target, rect);
      } finally {
        document.canvasFactory.destroy(surface);
        page.cleanup();
      }
    }
    setMetadata(out, stamped.marks, stamped.stamp, stamped.link, true);
    return Buffer.from(await out.save({ useObjectStreams: true }));
  } finally {
    await loading.destroy();
  }
}

/** ±2 levels of pseudo-random noise: invisible, but it defeats colour keying and diffing. */
function addNoise(context, width, height, seed) {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  let state = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < data.length; i += 4) {
    // xorshift32: fast and good enough for noise.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const delta = (state & 3) - 1.5;
    data[i] = Math.min(255, Math.max(0, data[i] + delta));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + delta));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + delta));
  }
  context.putImageData(image, 0, 0);
}

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const stamp = Boolean(options.text) && !(await alreadyMarked(bytes));
  // Only a fresh stamp is burned; a PDF that keeps its own watermark just gets the link.
  const wantBurn = stamp && options.burnIn !== false;
  const stamped = await stampVector(bytes, stamp, wantBurn);
  if (!stamped) process.exitCode = 3;
  else
    process.stdout.write(
      wantBurn && stamped.stamp ? await burn(stamped) : stamped.bytes,
    );
} catch (error) {
  process.stderr.write(String(error?.message || error).slice(0, 300));
  process.exitCode = 1;
}
