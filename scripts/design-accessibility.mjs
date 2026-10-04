import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { contentPath } from "../frontend/src/lib/types.ts";
const base = "http://127.0.0.1:5173";
const data = await (
  await fetch("http://127.0.0.1:4000/api/papers?limit=1")
).json();
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const results = [];
try {
  for (const theme of ["dark", "light"])
    for (const width of [360, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
        extraHTTPHeaders: { DNT: "1" },
      });
      await context.addInitScript(
        (value) => localStorage.setItem("buit-theme", value),
        theme,
      );
      const page = await context.newPage();
      for (const route of [
        "/",
        "/programs/btech/cse",
        "/papers",
        contentPath(data.data[0]),
        "/notes",
        "/admin/login",
      ]) {
        await page.goto(base + route);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        await page.addScriptTag({
          path: ".npm-cache/_npx/ed05d372d6adb15e/node_modules/axe-core/axe.min.js",
        });
        const violations = await page.evaluate(async () =>
          (
            await window.axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
              },
            })
          ).violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        results.push({ theme, width, route, overflow, violations });
        console.log(
          JSON.stringify({
            theme,
            width,
            route,
            overflow,
            issues: violations.map((v) => v.id),
          }),
        );
      }
      await context.close();
    }
} finally {
  await browser.close();
}
await writeFile(
  "docs/design/accessibility.json",
  JSON.stringify(results, null, 2),
);
if (results.some((r) => r.overflow || r.violations.length))
  process.exitCode = 1;
