// Builds short-notes PDFs: node short-notes/build.mjs [BE-101 ...]
// Renders src/<code>.html fragments with Chromium, then stamps the watermark on every page.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
const AUTHOR = "Ajeet Soni";
const MAX_PAGES = 10;

export const SUBJECTS = {
  "BE-101": "Engineering Mathematics-I (Calculus & Linear Algebra)",
  "BE-102": "Engineering Chemistry",
  "BE-103": "Technical English",
  "BE-104": "Basic Mechanical Engineering",
  "BE-105": "Basic Electronics Engineering",
  "BE-201": "Engineering Physics",
  "BE-202": "Basic Electrical Engineering",
  "BE-203": "Fundamentals of Computer Programming",
  "BE-204": "Basic Civil Engineering & Engineering Mechanics",
  "BE-205": "Engineering Graphics & CAD",
};

const css = await readFile(resolve(here, "style.css"), "utf8");
const available = (await readdir(resolve(here, "src"))).map((f) => f.replace(/\.html$/, ""));
const codes = process.argv.slice(2).length ? process.argv.slice(2) : available;

const page = (code, name, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${code} ${name} - Short Notes</title>
<style>${css}</style></head><body>
<div class="title-band">
  <div class="code">${code} · BTech First Year · UIT, Barkatullah University, Bhopal</div>
  <h1>${name} — Short Notes</h1>
  <div class="meta">Unit-wise complete syllabus coverage · Hinglish notes · Prepared by ${AUTHOR}</div>
</div>
${body}
</body></html>`;

const header = (code, name) => `<div style="width:100%;font-family:Segoe UI,Arial;font-size:7.5pt;color:#5a6577;padding:0 13mm;display:flex;justify-content:space-between;">
<span><b style="color:#1f4e8c">${code}</b> · ${name}</span><span>Short Notes · ${AUTHOR}</span></div>`;
const footer = `<div style="width:100%;font-family:Segoe UI,Arial;font-size:7.5pt;color:#5a6577;padding:0 13mm;text-align:center;">
Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

async function watermark(bytes, code) {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = `${code}  •  ${AUTHOR}`;
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    const size = 40;
    const w = font.widthOfTextAtSize(text, size);
    // Two diagonal stamps per page so the mark survives cropping.
    for (const cy of [height * 0.3, height * 0.72]) {
      const angle = (35 * Math.PI) / 180;
      p.drawText(text, {
        x: width / 2 - (w / 2) * Math.cos(angle),
        y: cy - (w / 2) * Math.sin(angle),
        size,
        font,
        color: rgb(0.12, 0.3, 0.55),
        opacity: 0.07,
        rotate: degrees(35),
      });
    }
  }
  doc.setTitle(`${code} ${SUBJECTS[code]} - Short Notes`);
  doc.setAuthor(AUTHOR);
  doc.setSubject(`${code} short notes (Hinglish)`);
  return doc.save();
}

await mkdir(resolve(here, "pdf"), { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const tab = await browser.newPage();
let failed = false;
for (const code of codes) {
  const name = SUBJECTS[code];
  if (!name) throw new Error(`Unknown subject code ${code}`);
  const body = await readFile(resolve(here, "src", `${code}.html`), "utf8");
  await tab.setContent(page(code, name, body), { waitUntil: "load" });
  const raw = await tab.pdf({
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: header(code, name),
    footerTemplate: footer,
    preferCSSPageSize: true,
  });
  const out = await watermark(raw, code);
  const pages = (await PDFDocument.load(out)).getPageCount();
  const file = `${code} ${name.replace(/[&]/g, "and").replace(/[^\w\- ()]/g, "")} - Short Notes.pdf`;
  await writeFile(resolve(here, "pdf", file), out);
  const ok = pages <= MAX_PAGES;
  if (!ok) failed = true;
  console.log(`${ok ? "OK  " : "OVER"} ${code}: ${pages} pages -> pdf/${file}`);
}
await browser.close();
if (failed) process.exitCode = 1;
