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
