// Browser check: contributor profile (photo / anonymous), leaderboard avatars and the
// standard-subjects setup preview. Frontend dev server only; the API is simulated.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import sharp from "sharp";

const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
const axe = ".npm-cache/_npx/ed05d372d6adb15e/node_modules/axe-core/axe.min.js";
const photo = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#4f7ad8" } })
  .webp()
  .toBuffer();
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const sent = [];
const profile = {
  name: "Riya Sharma",
  visibility: "public",
  displayName: "Riya S.",
  bio: "CSE 3rd year",
  photo: "/avatars/11111111-1111-4111-8111-111111111111.webp",
  published: 4,
};
const board = [
  { rank: 1, name: "Riya S.", photo: profile.photo, bio: "CSE 3rd year", papers: 9, notes: 1, total: 10, downloads: 140, firstPublishedAt: "2026-08-01" },
  { rank: 2, name: "Anonymous contributor", anonymous: true, photo: null, papers: 6, notes: 0, total: 6, downloads: 20, firstPublishedAt: "2026-08-03" },
  { rank: 3, name: "Anonymous contributor", anonymous: true, photo: null, papers: 2, notes: 0, total: 2, downloads: 3, firstPublishedAt: "2026-09-01" },
];
async function check(page, label) {
  await page.addScriptTag({ path: axe });
  const issues = await page.evaluate(async () =>
    (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map(
      (v) => `${v.id}: ${v.nodes[0]?.target}`,
    ),
  );
  assert.deepEqual(issues, [], `${label} accessibility`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${label} overflow`);
}
try {
  for (const [theme, width] of [["dark", 1280], ["light", 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let role = "contributor";
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname.replace(/^\/api/, "");
      const json = (data) => route.fulfill({ json: { data } });
      if (path.startsWith("/avatars/")) return route.fulfill({ contentType: "image/webp", body: photo });
      if (req.method() !== "GET") {
        sent.push({ path, method: req.method(), body: req.postDataJSON?.() ?? null });
        if (path === "/admin/taxonomy/standard-setup")
          return json({ program: "B.Tech", branches: ["ME"], semesters: [6, 7, 8], subjects: Array.from({ length: 140 }, (_, i) => `X-${i}`), renamed: [{ from: "CSE-101", to: "BE-101" }], merged: [], offerings: 210 });
        return json({ saved: true });
      }
      if (path === "/auth/me") return json({ _id: "u", name: role === "admin" ? "Ajeet Soni" : "Riya Sharma", role });
      if (path === "/auth/csrf") return json({ token: "t" });
      if (path === "/contributor/profile") return json(profile);
      if (path === "/contributors") return json(board);
      return json([]);
    });
    await page.goto(`${base}/contributor/profile`);
    await page.getByRole("heading", { name: "My public profile" }).waitFor();
    await page.locator(".photo-row img").waitFor();
    await check(page, `${theme} profile`);
    await page.getByRole("radio", { name: /Stay anonymous/ }).click();
    assert.equal(await page.locator(".profile-preview strong").first().textContent(), "Anonymous contributor");
    await page.screenshot({ path: `docs/design/profile-${theme}.png`, fullPage: true });
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.waitForTimeout(300);
    const saved = sent.find((s) => s.path === "/contributor/profile");
    assert.equal(saved.body.visibility, "anonymous");
    await page.goto(`${base}/contributors`);
    await page.locator(".podium .contributor-avatar img").first().waitFor();
    assert.equal(await page.locator(".contributor-avatar.is-anonymous").count(), 4);
    await check(page, `${theme} leaderboard`);
    await page.screenshot({ path: `docs/design/leaderboard-photos-${theme}.png`, fullPage: true });
    role = "admin";
    await page.goto(`${base}/admin/taxonomy`);
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByText("CSE-101 → BE-101").waitFor();
    await page.getByRole("button", { name: "Add subjects" }).click();
    await page.locator(".confirm-dialog").getByRole("button", { name: "Add subjects" }).click();
    await page.waitForTimeout(300);
    assert.equal(sent.filter((s) => s.path === "/admin/taxonomy/standard-setup").at(-1).body.dryRun, false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${theme} ${width}: passed`);
  }
} finally {
  await browser.close();
}
