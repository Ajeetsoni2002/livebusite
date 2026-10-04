import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { contentPath } from "../frontend/src/lib/types.ts";

const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Thumbnail browser verification is local-only");
const apiBase = "http://127.0.0.1:4000/api";
const catalog = await (await fetch(`${apiBase}/papers?limit=50`)).json();
const item = catalog.data[0];
assert.ok(
  item.hasThumbnail,
  "Backfill the real archive before checking thumbnails",
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { DNT: "1" },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/papers`);
  const images = page.locator(".resource .pdf-thumbnail img");
  await images.first().waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll(".resource .pdf-thumbnail img")).some(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  assert.equal(await images.first().getAttribute("loading"), "lazy");
  assert.equal(
    await images.first().getAttribute("crossorigin"),
    "use-credentials",
  );
  if (process.env.THUMBNAIL_API_ORIGIN)
    assert.equal(
      new URL(await images.first().getAttribute("src"), base).origin,
      process.env.THUMBNAIL_API_ORIGIN,
      "the image should load directly from the configured separate API origin",
    );
  await mkdir(".npm-cache", { recursive: true });
  await page.screenshot({
    path: ".npm-cache/thumbnails-desktop.png",
    fullPage: true,
  });
  await page.screenshot({ path: ".npm-cache/thumbnails-desktop-viewport.png" });
  const href = await page
    .locator(".resource-main")
    .first()
    .getAttribute("href");
  await page.goto(`${base}${href}`);
  const preview = page.locator(".preview .pdf-thumbnail img");
  await preview.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".preview .pdf-thumbnail img");
    return image?.complete && image.naturalWidth > 0;
  });
  assert.equal(
    await page.locator(".preview iframe").count(),
    0,
    "a thumbnail must not eagerly load the whole PDF",
  );
  await page.screenshot({ path: ".npm-cache/thumbnail-detail.png" });
  const shared = catalog.data.find(
    (resource) =>
      resource.offerings[0] &&
      catalog.data.some(
        (other) =>
          other._id !== resource._id &&
          other.offerings.some(
            (offering) => offering._id === resource.offerings[0]._id,
          ),
      ),
  );
  assert.ok(
    shared,
    "the real archive should contain papers sharing a subject offering",
  );
  await page.goto(`${base}${contentPath(shared)}`);
  await page
    .getByRole("heading", { name: "Same subject, another year." })
    .waitFor();
  assert.ok(
    (await page.locator(".library-section .resource").count()) > 0,
    "related-paper cards should render without a metadata error",
  );
  await context.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { DNT: "1" },
  });
  const phone = await mobile.newPage();
  await phone.goto(`${base}/papers`);
  await phone.locator(".resource .pdf-thumbnail img").first().waitFor();
  await phone.waitForFunction(() => {
    const image = document.querySelector(".resource .pdf-thumbnail img");
    return image?.complete && image.naturalWidth > 0;
  });
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await phone.screenshot({
    path: ".npm-cache/thumbnails-mobile.png",
    fullPage: true,
  });
  await phone.screenshot({ path: ".npm-cache/thumbnails-mobile-viewport.png" });
  await phone.route("**/thumbnail", (route) => route.abort());
  await phone.reload();
  await phone.locator(".resource .file-icon").first().waitFor();
  await phone.route("**/api/**", (route) => route.abort());
  await phone.reload();
  await phone.getByText(/viewing a saved library/).waitFor();
  await phone.locator(".resource .file-icon").first().waitFor();
  assert.equal((await phone.locator(".resource").count()) > 0, true);
  assert.deepEqual(errors, []);
  await mobile.close();
  console.info(
    "Thumbnail browser checks passed: credentialed images, lazy previews, related-paper cards, mobile layout, rendering fallback and API outage.",
  );
} finally {
  await browser.close();
}
