import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { chromium } from "@playwright/test";
import { config } from "../backend/src/config.ts";
import {
  User,
  Session,
  Note,
  AuditLog,
  SubjectOffering,
} from "../backend/src/modules/models.ts";
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
if (
  process.env.NODE_ENV === "production" ||
  !/^mongodb:\/\/(?:127\.0\.0\.1|localhost):/.test(config.mongoUri) ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname)
)
  throw new Error(
    "Browser smoke fixtures are allowed only on a local development DB and website.",
  );
const password = `Test!${randomBytes(14).toString("hex")}`,
  replacement = `Changed!${randomBytes(14).toString("hex")}`;
const suffix = randomBytes(6).toString("hex"),
  title = `Browser fixture ${suffix}`,
  users = [];
let browser, lastPage;
await mongoose.connect(config.mongoUri);
try {
  const offerings = await SubjectOffering.find().limit(2).lean();
  assert.equal(
    offerings.length,
    2,
    "Seed the real archive before browser verification.",
  );
  for (const role of ["admin", "contributor"])
    users.push(
      await User.create({
        name: "Browser verification",
        email: `browser-${role}-${suffix}@example.test`,
        role,
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: role === "contributor",
      }),
    );
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { DNT: "1" },
  });
  const page = await context.newPage(),
    errors = [];
  lastPage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Recently added" }).waitFor();
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "Open search", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("CSE-303");
  assert.equal(
    await dialog
      .getByRole("combobox")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
      return ids.length === new Set(ids).size;
    }),
    true,
  );
  await page.keyboard.press("Escape");
  await page.goto(`${base}/papers?page=2`);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.waitForURL(
    (url) =>
      !url.searchParams.has("page") || url.searchParams.get("page") === "1",
  );
  await page.goto(`${base}/admin`);
  await page.waitForURL("**/admin/login");
  async function login(user) {
    await page.goto(`${base}/${user.role}/login`);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await login(users[1]);
  await page
    .getByRole("heading", { name: "Make this account yours." })
    .waitFor();
  await page.getByLabel("Current temporary password").fill(password);
  await page.getByLabel("New password").fill(replacement);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.getByRole("heading", { name: "My contributions" }).waitFor();
  await page.goto(`${base}/contributor/upload?kind=notes`);
  await page.getByLabel("Format", { exact: true }).selectOption("markdown");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Subject / branch / semester")
    .selectOption(offerings.map((o) => String(o._id)));
  await page
    .getByLabel("Markdown content")
    .fill(
      "# Safe fixture\n\n**Readable notes**\n\n<script>window.unsafeNote=true</script>\n[Bad link](javascript:alert(1))",
    );
  await page.getByLabel("Author credit").fill("Browser test fixture");
  await page.getByRole("button", { name: "Submit resource" }).click();
  await page.getByRole("heading", { name: "My contributions" }).waitFor();
  const note = await Note.findOne({ author: users[1]._id, title }).lean();
  assert.ok(note);
  assert.equal(note.status, "pending");
  assert.equal(note.offerings.length, 2);
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(users[0]);
  await page.getByRole("link", { name: "Moderation", exact: true }).waitFor();
  await page.goto(`${base}/admin/upload?kind=notes&edit=${note._id}`);
  await page.getByLabel("Title", { exact: true }).waitFor();
  assert.equal(
    (
      await page
        .getByLabel("Subject / branch / semester")
        .evaluate((el) => [...el.selectedOptions].map((o) => o.value))
    ).length,
    2,
  );
  await page.getByLabel("Title", { exact: true }).fill(`${title} edited`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page
    .getByRole("heading", { name: "Short notes", exact: true })
    .waitFor();
  assert.equal((await Note.findById(note._id)).offerings.length, 2);
  await page.goto(`${base}/admin/moderation`);
  const row = page.getByRole("row").filter({ hasText: `${title} edited` });
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  assert.equal((await Note.findById(note._id)).status, "published");
  await page.goto(`${base}/notes/${note.slug}`);
  await page.getByRole("heading", { name: "Safe fixture" }).waitFor();
  assert.equal(await page.locator(".markdown script").count(), 0);
  assert.equal(
    await page.locator('.markdown a[href^="javascript:"]').count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.unsafeNote), undefined);
  for (const path of [
    "taxonomy",
    "contributors",
    "inbox",
    "audit",
    "analytics",
  ]) {
    await page.goto(`${base}/admin/${path}`);
    await page.locator(".staff-content").waitFor();
    assert.equal(await page.getByText("Something went wrong.").count(), 0);
  }
  const outage = await browser.newContext({
      baseURL: base,
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { DNT: "1" },
    }),
    mobile = await outage.newPage();
  lastPage = mobile;
  await mobile.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":{"message":"Test outage"}}',
    }),
  );
  await mobile.goto(base);
  await mobile.getByText("Waking up the server…", { exact: false }).waitFor();
  await mobile.locator(".resource").first().waitFor();
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mkdir(".npm-cache", { recursive: true });
  await mobile.screenshot({
    path: ".npm-cache/verified-mobile.png",
    fullPage: true,
  });
  await mobile.unroute("**/api/**");
  await mobile
    .getByText("Waking up the server…", { exact: false })
    .waitFor({ state: "hidden", timeout: 30000 });
  await mobile.goto(`${base}/papers`);
  await mobile.locator(".resource-main").first().click();
  await mobile.getByRole("button", { name: "Open preview" }).click();
  await mobile.locator("iframe").waitFor();
  const preview = await mobile.request.get(
    await mobile.locator("iframe").getAttribute("src"),
  );
  assert.equal(preview.status(), 200);
  assert.ok((await preview.body()).subarray(0, 5).toString() === "%PDF-");
  const mapping = await (await mobile.request.get("/legacy-map.json")).json();
  const legacy = Object.keys(mapping).find(
    (key) => key.endsWith(".pdf") && mapping[key].startsWith("/papers/"),
  );
  await mobile.goto(
    `${base}${legacy.split("/").map(encodeURIComponent).join("/")}`,
  );
  await mobile.waitForURL((url) => url.pathname === mapping[legacy]);
  assert.equal((await mobile.request.get("/legacy/portfolio/")).status(), 200);
  assert.deepEqual(errors, []);
  console.info(
    "Browser smoke passed: keyboard search, pagination, role guards, forced password change, shared Markdown notes, moderation, safe rendering, staff screens, mobile fallback/recovery, real PDF preview and legacy links.",
  );
} catch (error) {
  if (lastPage) {
    console.error(
      "Browser failure at",
      lastPage.url(),
      (await lastPage.locator("body").innerText()).slice(0, 2000),
    );
    await lastPage
      .screenshot({ path: ".npm-cache/browser-failure.png", fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  const ids = users.map((user) => user._id),
    notes = await Note.find({ author: { $in: ids } }).select("_id");
  await Note.deleteMany({ author: { $in: ids } });
  await Session.deleteMany({ user: { $in: ids } });
  await AuditLog.deleteMany({
    $or: [
      { actor: { $in: ids } },
      { target: { $in: notes.map((note) => `notes/${note._id}`) } },
    ],
  });
  await User.deleteMany({ _id: { $in: ids } });
  await mongoose.disconnect();
}
