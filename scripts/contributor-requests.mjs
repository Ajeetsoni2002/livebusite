// Browser check of the contributor request flow (frontend dev server; API simulated).
// Usage: node scripts/contributor-requests.mjs
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const snapshot = JSON.parse(readFileSync("frontend/public/snapshot.json", "utf8"));
const axe = ".npm-cache/_npx/ed05d372d6adb15e/node_modules/axe-core/axe.min.js";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const sent = [];
const request = {
  _id: "r".repeat(24).replace(/r/g, "a"),
  name: "Riya Sharma",
  email: "riya@example.test",
  phone: "+91 98765 43210",
  branch: "CSE",
  semester: 3,
  message: "I have 2023 and 2024 end-semester papers for CSE semester 3.",
  status: "open",
  createdAt: new Date().toISOString(),
};
try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname.replace(/^\/api/, "");
      const json = (data, status = 200) => route.fulfill({ status, json: { data } });
      if (req.method() === "POST") {
        sent.push({ path, body: req.postDataJSON() });
        if (path.endsWith("/approve"))
          return json({ user: { _id: "u2" }, temporaryPassword: "Tmp-Pass_12345" });
        return json({ received: true }, 201);
      }
      if (path === "/branches") return json(snapshot.branches);
      if (path === "/auth/me") return json({ _id: "u", name: "Ajeet Soni", role: "admin" });
      if (path === "/auth/csrf") return json({ token: "t" });
      if (path === "/admin/contributor-requests") return json([request]);
      return json([]);
    });
    await page.goto(`${base}/contribute`);
    await page.addScriptTag({ path: axe });
    const issues = await page.evaluate(async () =>
      (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map((v) => v.id),
    );
    assert.deepEqual(issues, [], `${theme} /contribute accessibility`);
    if (theme === "dark") {
      await page.fill('input[name="name"]', "Riya Sharma");
      await page.fill('input[name="email"]', "riya@example.test");
      await page.fill('input[name="phone"]', "+91 98765 43210");
      await page.selectOption('select[name="branch"]', { index: 1 });
      await page.selectOption('select[name="semester"]', "3");
      await page.fill('textarea[name="message"]', request.message);
      await page.check('input[name="consent"]');
      await page.screenshot({ path: "docs/design/contribute-form.png", fullPage: true });
      await page.getByRole("button", { name: /Request contributor access/ }).click();
      await page.getByText("Request received.").waitFor();
      const body = sent.find((s) => s.path === "/contributor-requests").body;
      assert.equal(body.consent, true);
      assert.equal(body.semester, 3);
      assert.equal(body.website, undefined);
    }
    await page.goto(`${base}/admin/contributors`);
    await page.getByText("Riya Sharma").first().waitFor();
    if (theme === "light") {
      await page.getByRole("button", { name: /Approve & create account/ }).click();
      await page.locator(".confirm-dialog").getByRole("button", { name: "Approve" }).click();
      await page.getByText("Tmp-Pass_12345").waitFor();
      const wa = await page.getByRole("link", { name: /WhatsApp/ }).getAttribute("href");
      assert.match(wa, /^https:\/\/wa\.me\/919876543210\?text=/);
      assert.match(decodeURIComponent(wa), /Temporary password: Tmp-Pass_12345/);
      await page.screenshot({ path: "docs/design/contribute-approved.png" });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.equal(overflow, 0);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${theme}: passed`);
  }
} finally {
  await browser.close();
}
