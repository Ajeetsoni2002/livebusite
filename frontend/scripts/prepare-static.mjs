import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(frontend, ".."),
  pub = resolve(frontend, "public");
await mkdir(resolve(pub, "branding"), { recursive: true });
await sharp(resolve(root, "images/logo.png"))
  .resize(84, 84)
  .webp({ quality: 85 })
  .toFile(resolve(pub, "branding/crest.webp"));
// Favicons: Google shows a 48px multiple next to search results; phones use 180/192.
const logo = resolve(root, "images/logo.png");
for (const [name, size] of [
  ["icon-48.png", 48],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
])
  await sharp(logo)
    .resize(size, size, { fit: "contain", background: "#f3eee2" })
    .flatten({ background: "#f3eee2" })
    .png()
    .toFile(resolve(pub, "branding", name));
// favicon.ico is still requested at the root by browsers and crawlers: a PNG-in-ICO.
const icoPng = await sharp(logo)
  .resize(48, 48, { fit: "contain", background: "#00000000" })
  .png()
  .toBuffer();
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt8(48, 6);
icoHeader.writeUInt8(48, 7);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(icoPng.length, 14);
icoHeader.writeUInt32LE(22, 18);
await writeFile(
  resolve(pub, "favicon.ico"),
  Buffer.concat([icoHeader, icoPng]),
);
// The picture WhatsApp, Telegram and search show when the site is shared (1200x630).
const ogText = (text) =>
  text.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#f3eee2"/>
  <g stroke="#1a1d2614" stroke-width="2">${Array.from({ length: 14 }, (_, i) => `<line x1="0" x2="1200" y1="${120 + i * 38}" y2="${120 + i * 38}"/>`).join("")}</g>
  <rect x="92" y="0" width="5" height="630" fill="#b82424" opacity="0.8"/>
  <text x="150" y="250" font-family="Georgia, 'DejaVu Serif', serif" font-size="92" fill="#1a1d26">BUIT <tspan fill="#1f3ea8" font-style="italic">Papers</tspan></text>
  <text x="152" y="320" font-family="Arial, 'DejaVu Sans', sans-serif" font-size="38" fill="#1a1d26">${ogText("Barkatullah University previous year")}</text>
  <text x="152" y="370" font-family="Arial, 'DejaVu Sans', sans-serif" font-size="38" fill="#1a1d26">${ogText("question papers & short notes")}</text>
  <text x="152" y="450" font-family="Arial, 'DejaVu Sans', sans-serif" font-size="28" fill="#57534a">${ogText("B.Tech · All branches · All semesters · Free PDF")}</text>
  <rect x="152" y="500" width="300" height="56" rx="28" fill="#1f3ea8"/>
  <text x="302" y="537" text-anchor="middle" font-family="Arial, 'DejaVu Sans', sans-serif" font-size="26" font-weight="bold" fill="#ffffff">${ogText("Free · No sign-up")}</text>
</svg>`;
await sharp({
  create: { width: 1200, height: 630, channels: 4, background: "#f3eee2" },
})
  .composite([
    { input: Buffer.from(ogSvg) },
    {
      input: await sharp(logo).resize(230, 230).png().toBuffer(),
      left: 880,
      top: 160,
    },
  ])
  .png()
  .toFile(resolve(pub, "branding/og.png"));
await cp(
  resolve(root, "Portfolio_Website/portfolio website"),
  resolve(pub, "legacy/portfolio"),
  { recursive: true },
);
// PDF.js decoders for JPEG 2000 / JBIG2 scans and colour profiles, served same-origin.
const pdfjsWasm = resolve(
  dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
  "wasm",
);
await mkdir(resolve(pub, "pdfjs/wasm"), { recursive: true });
for (const name of await readdir(pdfjsWasm))
  if (!name.startsWith("quickjs"))
    await cp(resolve(pdfjsWasm, name), resolve(pub, "pdfjs/wasm", name));
const manifest = JSON.parse(
  await readFile(resolve(root, "migration/manifest.json"), "utf8"),
);
const snapshot = JSON.parse(
  await readFile(resolve(pub, "snapshot.json"), "utf8"),
);
const mapping = {};
for (const asset of manifest.assets) {
  const paper = snapshot.papers.find((p) =>
    p.slug.endsWith(asset.hash.slice(0, 8)),
  );
  const offering = paper?.offerings[0];
  const target =
    paper && offering
      ? `/papers/${offering.program.slug}/${offering.branch.slug}/sem-${offering.semester.number}/${offering.subject.slug}/${paper.year || "unknown"}/${paper.slug}`
      : `/papers?q=${encodeURIComponent(asset.code || asset.originalName.replace(/\.pdf$/i, ""))}`;
  for (const source of asset.sources) mapping[`/${source}`] = target;
}
mapping["/other pages 1/branch page/choose branch.html"] = "/papers";
mapping["/other pages 1/branch page/other pages2/papers page/allpapers.html"] =
  "/programs/btech/cse";
mapping["/Portfolio_Website/portfolio website/index.html"] =
  "/legacy/portfolio/";
await writeFile(resolve(pub, "legacy-map.json"), JSON.stringify(mapping));
console.info(
  `Prepared optimized branding, original portfolio and ${Object.keys(mapping).length} legacy links.`,
);
