import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import path from "node:path";
const stage = process.argv[2] || "after";
if (!/^[a-z0-9-]+$/.test(stage)) throw new Error("Invalid stage");
const { default: lighthouse } = await import(
  pathToFileURL(
    path.resolve(
      ".npm-cache/_npx/ed05d372d6adb15e/node_modules/lighthouse/core/index.js",
    ),
  )
);
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--remote-debugging-port=9333"],
});
try {
  const result = await lighthouse("http://127.0.0.1:4173/", {
    port: 9333,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    extraHeaders: { DNT: "1" },
  });
  await mkdir("docs/design", { recursive: true });
  await writeFile(`docs/design/lighthouse-${stage}.json`, result.report);
  const html = await readFile("frontend/dist/index.html", "utf8");
  const files = [
    ...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g),
  ].map((m) => m[1]);
  const bundle = await Promise.all(
    files.map(async (name) => {
      const data = await readFile("frontend/dist" + name);
      return { name, bytes: data.length, gzip: gzipSync(data).length };
    }),
  );
  const summary = {
    stage,
    categories: Object.fromEntries(
      Object.entries(result.lhr.categories).map(([k, v]) => [k, v.score * 100]),
    ),
    metrics: Object.fromEntries(
      [
        "first-contentful-paint",
        "largest-contentful-paint",
        "total-blocking-time",
        "cumulative-layout-shift",
      ].map((k) => [k, result.lhr.audits[k].numericValue]),
    ),
    bundle,
  };
  await writeFile(
    `docs/design/performance-${stage}.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close();
}
