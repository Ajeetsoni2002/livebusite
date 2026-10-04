import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { contentPath } from "../frontend/src/lib/types.ts";

const stage = process.argv[2] || "after";
if (!/^[a-z0-9-]+$/.test(stage)) throw new Error("Use a simple stage name");
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Local-only verification");
const catalog = await (
  await fetch("http://127.0.0.1:4000/api/papers?limit=1")
).json();
const paper = catalog.data[0];
const routes = {
  home: "/",
  branch: "/programs/btech/cse",
  listing: "/papers",
  detail: contentPath(paper),
  notes: "/notes",
};
const chosen = process.argv.slice(3);
const output = `docs/design/screenshots/${stage}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const results = [];
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      extraHTTPHeaders: { DNT: "1" },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    if (process.env.DESIGN_THEME === "light")
      await context.addInitScript(() =>
        localStorage.setItem("buit-theme", "light"),
      );
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const [name, path] of Object.entries(routes)) {
      if (chosen.length && !chosen.includes(name)) continue;
      await page.goto(base + path);
      await page.locator("main h1").first().waitFor();
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      // Visit the document before capturing to settle lazy thumbnails/reveals.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        scrollTo(0, 0);
      });
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${name} overflows at ${width}px`,
      );
      await page.screenshot({
        path: `${output}/${name}-${width}.png`,
        fullPage: true,
      });
      await page.screenshot({
        path: `${output}/${name}-${width}-viewport.png`,
      });
      if (name === "home" && (await page.locator(".explore-section").count()))
        await page
          .locator(".explore-section")
          .screenshot({ path: `${output}/branches-${width}.png` });
      results.push({ name, width, path, errors: [...errors] });
      assert.deepEqual(errors, [], `${name} browser errors`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${output}/checks.json`, JSON.stringify(results, null, 2));
console.log(
  `${stage}: ${results.length} screenshots sets; no overflow or browser exceptions.`,
);
