// Proves previews never show a sleeping backend's own page.
// Needs only the frontend dev server (npm run dev -w frontend); every /api call is simulated.
// Usage: node scripts/preview-wakeup.mjs
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const snapshot = JSON.parse(readFileSync("frontend/public/snapshot.json", "utf8"));
const pdfDir = "short-notes/pdf";
const pdf = readFileSync(
  `${pdfDir}/${readdirSync(pdfDir).find((name) => name.endsWith(".pdf"))}`,
);
const renderPage =
  "<!doctype html><html><body><h1>SERVICE WAKING UP...</h1><p>Render</p></body></html>";
const lists = ["papers", "notes", "branches", "semesters", "subjects", "offerings", "programs", "universities"];

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const results = [];
try {
  for (const [name, script] of [
    // Raw Render HTML (no proxy), then the proxy's JSON 503, then the PDF.
    ["quick-look wakes up", ["html", "html", "json503", "pdf"]],
    ["detail page", ["pdf"]],
    ["missing file", ["404", "404"]],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let previews = 0,
      pings = 0;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, "");
      if (path === "/ping") {
        pings++;
        return route.fulfill({ json: { data: { server: "alive" } } });
      }
      if (/\/preview$/.test(path)) {
        assert.equal(url.searchParams.get("stream"), "1");
        const step = script[Math.min(previews++, script.length - 1)];
        if (step === "html")
          return route.fulfill({ status: 503, contentType: "text/html", body: renderPage });
        if (step === "json503")
          return route.fulfill({
            status: 503,
            json: { error: { code: "WAKING_UP", message: "waking" } },
          });
        if (step === "404")
          return route.fulfill({ status: 404, json: { error: { message: "gone" } } });
        return route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
      }
      const list = lists.find((key) => path === `/${key}`);
      if (list)
        return route.fulfill({
          json: { data: snapshot[list], meta: { total: snapshot[list].length, page: 1, pages: 1 } },
        });
      const detail = snapshot.papers.find((p) => path === `/papers/${p.slug}`);
      if (detail) return route.fulfill({ json: { data: detail } });
      return route.fulfill({ json: { data: [] } });
    });
    if (name === "detail page") {
      await page.goto(`${base}/paper/${snapshot.papers[0].slug}`);
      await page.getByRole("button", { name: "Open preview" }).click();
    } else {
      await page.goto(`${base}/papers`);
      await page.getByRole("button", { name: "Quick preview" }).first().click();
    }
    const scope = page.locator(name === "detail page" ? ".preview" : ".quick-preview");
    if (name === "quick-look wakes up") {
      await scope.getByText("Waking up the library").waitFor({ timeout: 15_000 });
      await page.screenshot({ path: "docs/design/preview-waking.png" });
    }
    if (name === "missing file") {
      await scope.getByText("We couldn’t open the preview").waitFor({ timeout: 15_000 });
      assert.equal(await scope.getByRole("button", { name: "Download PDF" }).count(), 1);
    } else {
      await scope.locator("canvas.pdf-page").first().waitFor({ timeout: 40_000 });
      await page.waitForTimeout(800);
      const painted = await scope.locator("canvas.pdf-page").first().evaluate((canvas) => {
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4 * 97) if (data[i] < 128) dark++;
        return { width: canvas.width, dark };
      });
      assert.ok(painted.width > 100 && painted.dark > 20, "first page is rendered");
      if (name === "quick-look wakes up")
        await page.screenshot({ path: "docs/design/preview-ready.png" });
    }
    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, /SERVICE WAKING UP/i, "foreign page never shown");
    assert.equal(await page.locator("iframe").count(), 0, "no iframes");
    assert.ok(pings >= 1, "API was pinged");
    assert.deepEqual(errors, []);
    results.push(`${name}: passed (${previews} preview requests, ${pings} pings)`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(results.join("\n"));
