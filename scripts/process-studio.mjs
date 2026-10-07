// End-to-end check of the Process Studio with real sample PDFs (frontend dev server only;
// the API is simulated). Usage: node scripts/process-studio.mjs samples/a.pdf samples/b.pdf
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const [first, second] = process.argv.slice(2);
assert.ok(first && second, "Pass two sample PDFs");
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const snapshot = JSON.parse(
  readFileSync("frontend/public/snapshot.json", "utf8"),
);
const out = "docs/processing";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const posts = [];
async function session(width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const json = (data, extra = {}) =>
      route.fulfill({ json: { data, ...extra } });
    if (req.method() === "POST") {
      const body = req.postDataBuffer() || Buffer.alloc(0);
      posts.push({ path, body: body.toString("latin1") });
      return json({ _id: "x", status: "pending", activeVersion: "processed" });
    }
    if (path === "/auth/me")
      return json({ _id: "u", name: "Ajeet Soni", role: "admin" });
    if (path === "/auth/csrf") return json({ token: "t" });
    if (path === "/offerings") return json(snapshot.offerings);
    if (path === "/admin/papers")
      return json(
        [
          {
            ...snapshot.papers[0],
            _id: "a".repeat(24),
            title: "CSE-702 sample",
            status: "pending",
            watermark: { status: "done" },
          },
        ],
        { meta: { total: 1, page: 1, pages: 1 } },
      );
    if (path.endsWith("/source/original"))
      return route.fulfill({
        contentType: "application/pdf",
        body: readFileSync(second),
      });
    return json([]);
  });
  return { context, page, errors };
}
const field = (body, name) => {
  const i = body.indexOf(`name="${name}"`);
  return i < 0 ? null : body.slice(i, i + 600);
};
try {
  // 1) Upload flow: Studio opens before anything is sent.
  {
    const { context, page, errors } = await session();
    await page.goto(`${base}/admin/upload?kind=papers`);
    await page.setInputFiles('input[aria-label="Choose PDFs"]', first);
    await page.fill('input[name="title"]', "BE-102 sample");
    await page.click('button[aria-label="Subject / branch / semester"]');
    await page.locator(".offering-list input").first().check();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Submit resource" }).click();
    const studio = page.locator("dialog.studio");
    await studio.locator(".studio-thumb").first().waitFor();
    await studio
      .getByRole("button", { name: /Upload processed version/ })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector("dialog.studio .spin"),
    );
    const thumbs = await studio.locator(".studio-thumb").count();
    await studio.locator(".studio-thumb").nth(2).click();
    await page.locator(".studio-slider").fill("35");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/studio-upload.png` });
    assert.equal(posts.length, 0, "nothing uploaded before the choice");
    await studio
      .getByRole("button", { name: /Upload processed version/ })
      .click();
    await page.waitForURL(/\/admin\/papers/);
    const upload = posts.find((p) => p.path === "/admin/papers");
    assert.ok(upload, "upload sent");
    assert.ok(field(upload.body, "file"), "original attached");
    assert.ok(field(upload.body, "processed"), "processed attached");
    const metadata = JSON.parse(
      upload.body.match(/name="metadata"\r\n\r\n([^\r\n]+)/)[1],
    );
    assert.equal(metadata.useVersion, "processed");
    console.log(
      `upload flow: ${thumbs} output pages, report ${JSON.stringify(metadata.processedMeta)}`,
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  // 2) Admin one-click on an existing item.
  {
    posts.length = 0;
    const { context, page, errors } = await session(390);
    await page.goto(`${base}/admin/papers`);
    await page.locator("summary[aria-label^='More actions']").first().click();
    await page.getByRole("button", { name: "Process & preview" }).click();
    const studio = page.locator("dialog.studio");
    await studio
      .getByRole("button", { name: /Apply processed version/ })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector("dialog.studio .spin"),
    );
    await page.screenshot({ path: `${out}/studio-mobile.png` });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    await studio
      .getByRole("button", { name: /Apply processed version/ })
      .click();
    await page.locator("dialog.studio").waitFor({ state: "detached" });
    const apply = posts.find((p) => p.path.endsWith("/processed"));
    assert.ok(apply, "processed version sent");
    const meta = JSON.parse(
      apply.body.match(/name="metadata"\r\n\r\n([^\r\n]+)/)[1],
    );
    console.log(
      `admin flow: report ${JSON.stringify(meta.processedMeta)}, overflow ${overflow}`,
    );
    assert.equal(meta.activate, true);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
