import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Story browser verification is local-only");
const portfolio = "https://ajeet-portfolio-welcome10.vercel.app/";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage();
  for (const path of ["/about", "/our-story", "/story"]) {
    await page.goto(base + path);
    await page.getByRole("heading", { name: "Built together. Passed forward." }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Built together. Passed forward." }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/about");
  }
  await page.goto(base + "/");
  await page.locator(".site-footer").getByRole("link", { name: "Our story", exact: true }).click();
  await page.getByRole("heading", { name: "Built together. Passed forward." }).waitFor();
  assert.ok(await page.locator(`main a[href="${portfolio}"]`).count());
  await page.goto(base + "/this-page-does-not-exist");
  await page.getByRole("heading", { name: "Page not found", exact: true }).waitFor();

  await mkdir("docs/design/screenshots/story", { recursive: true });
  for (const theme of ["dark", "light"]) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(base + "/");
      await page.evaluate((theme) => localStorage.setItem("buit-theme", theme), theme);
      await page.reload();
      await page.locator(".creator-credit").waitFor();
      const links = page.locator(`a[href="${portfolio}"]`);
      assert.equal(await links.count(), 3, "Home has hero, contribution, and footer credits");
      for (const link of await links.all()) {
        assert.match(await link.textContent(), /Ajeet Kumar Soni/);
        assert.equal(await link.getAttribute("target"), "_blank");
        assert.match(await link.getAttribute("rel"), /noopener/);
      }
      await page.goto(base + "/about");
      await page.getByRole("heading", { name: "Built together. Passed forward." }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `docs/design/screenshots/story/about-${theme}-${width}.png`, fullPage: true });
    }
  }
  console.log("Story checks passed: direct links, reloads, footer navigation, four creator placements, portfolio safety, both themes and widths.");
} finally {
  await browser.close();
}
