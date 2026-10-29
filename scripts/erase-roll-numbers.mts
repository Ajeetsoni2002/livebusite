// Paints over handwritten roll numbers on page 1 of every published paper and saves the
// result as the paper's processed version (the original stays private and restorable).
//
//   node --env-file=backend/.env.production --import tsx scripts/erase-roll-numbers.mts [--dry] [--out=dir] [id ...]
//
// Uses ADMIN_EMAIL / ADMIN_PASSWORD from the env file and the same detection as the
// browser processing studio. Only page 1 is re-rendered; other pages are copied as-is.
import { mkdirSync, writeFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { toGray } from "../frontend/src/lib/processing/core.ts";
import {
  eraseRollNumber,
  findRollNumber,
  inkShare,
  INK_THRESHOLD,
  OCR_TOP,
  wordsFrom,
} from "../frontend/src/lib/processing/rollnumber.ts";

const API = process.env.ERASE_API || "https://buit-papers-api.onrender.com/api";
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const out = args.find((a) => a.startsWith("--out="))?.slice(6);
const only = args.filter((a) => /^[a-f0-9]{24}$/i.test(a));
if (out) mkdirSync(out, { recursive: true });

const cookies = new Map<string, string>();
let csrf = "";
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  for (;;) {
    const res = await fetch(API + path, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      cookies.set(
        pair.slice(0, pair.indexOf("=")),
        pair.slice(pair.indexOf("=") + 1),
      );
    }
    // Uploads are limited per hour; wait for the window instead of failing.
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") || 600);
      console.log(`  rate limited, waiting ${Math.ceil(wait / 60)} min`);
      await new Promise((r) => setTimeout(r, (wait + 5) * 1000));
      continue;
    }
    if (!res.ok)
      throw new Error(
        `${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    return res;
  }
}
const json = async (path: string, init?: RequestInit) =>
  (await (await call(path, init)).json()) as any;

csrf = (await json("/auth/csrf")).data.token;
await json("/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  }),
});

const papers: any[] = [];
for (let page = 1; ; page++) {
  const { data, meta } = await json(`/admin/papers?page=${page}`);
  papers.push(...data);
  if (page >= meta.pages) break;
}
const targets = papers.filter(
  (p) =>
    p.status === "published" &&
    !p.deletedAt &&
    (!only.length || only.includes(p._id)),
);
const worker = await createWorker("eng");
const summary = { erased: 0, clean: 0, skipped: 0, failed: 0 };

for (const [n, paper] of targets.entries()) {
  const label = `${n + 1}/${targets.length} ${paper.title}`;
  try {
    if (paper.files?.processedMeta?.redacted?.length) {
      summary.skipped++;
      console.log(`skip  ${label} (already erased)`);
      continue;
    }
    const version =
      paper.activeVersion === "processed" && paper.files?.processed
        ? "processed"
        : "original";
    const bytes = new Uint8Array(
      await (
        await call(`/admin/papers/${paper._id}/source/${version}`)
      ).arrayBuffer(),
    );
    const loading = getDocument({ data: bytes.slice(), verbosity: 0 });
    const doc = await loading.promise;
    const first = await doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    // The browser studio renders scans at most 2200 px on the long side.
    const viewport = first.getViewport({
      scale: Math.min(2200 / Math.max(base.width, base.height), 200 / 72),
    });
    const width = Math.ceil(viewport.width),
      height = Math.ceil(viewport.height);
    const canvas = doc.canvasFactory.create(width, height);
    await first.render({
      canvasContext: canvas.context,
      viewport,
      background: "white",
    }).promise;
    const text = (await first.getTextContent()).items.length;
    await loading.destroy();
    if (text > 20) {
      summary.clean++;
      console.log(`clean ${label} (text page, not a scan)`);
      continue;
    }
    const raw = await sharp(canvas.canvas.toBuffer("image/png"))
      .ensureAlpha()
      .raw()
      .toBuffer();
    const img = { width, height, data: new Uint8ClampedArray(raw) };
    const top = await sharp(raw, { raw: { width, height, channels: 4 } })
      .extract({ left: 0, top: 0, width, height: Math.round(height * OCR_TOP) })
      .png()
      .toBuffer();
    const { data } = await worker.recognize(top, {}, { blocks: true });
    const match = findRollNumber(wordsFrom(data.blocks as any), width, height);
    if (!match || inkShare(toGray(img), match) < INK_THRESHOLD) {
      summary.clean++;
      console.log(`clean ${label}`);
      continue;
    }
    const erased = eraseRollNumber(img, match);
    const jpeg = await sharp(Buffer.from(erased.data), {
      raw: { width, height, channels: 4 },
    })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    // New page 1 at the size it is displayed (rotation applied); the rest copied as-is.
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const result = await PDFDocument.create();
    const image = await result.embedJpg(jpeg);
    result
      .addPage([base.width, base.height])
      .drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
    const rest = source.getPageIndices().slice(1);
    for (const page of await result.copyPages(source, rest))
      result.addPage(page);
    result.setProducer("BUIT Papers");
    const pdf = await result.save({ useObjectStreams: true });
    if (out) {
      writeFileSync(`${out}/${paper._id}.pdf`, pdf);
      writeFileSync(`${out}/${paper._id}-p1.jpg`, jpeg);
    }
    if (!dry) {
      const previous = paper.files?.processedMeta || {};
      const processedMeta = {
        pages: result.getPageCount(),
        sourcePages: source.getPageCount(),
        split: previous.split || [],
        enhanced: previous.enhanced || [],
        redacted: [1],
        preset: previous.preset || "color",
        mode: previous.mode || "none",
      };
      const form = new FormData();
      form.append(
        "metadata",
        JSON.stringify({ processedMeta, activate: true }),
      );
      form.append(
        "processed",
        new Blob([pdf], { type: "application/pdf" }),
        "processed.pdf",
      );
      await call(`/admin/papers/${paper._id}/processed`, {
        method: "POST",
        body: form,
      });
    }
    summary.erased++;
    console.log(`${dry ? "would erase" : "erased"} ${label}`);
  } catch (error) {
    summary.failed++;
    console.log(`FAIL  ${label}: ${(error as Error).message}`);
  }
}
await worker.terminate();
console.log(JSON.stringify(summary));
