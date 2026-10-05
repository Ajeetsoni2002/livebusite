import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Local-only checks");
const check = process.argv[2] || "palette";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { DNT: "1" },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  if (check === "palette") {
    await page
      .getByRole("button", { name: "Open search", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Search library" });
    await dialog.getByRole("combobox").fill("CSE");
    await expect(
      dialog.getByRole("heading", { name: "Papers", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Notes", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Branches", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("option", { name: /CSE-/ }).first(),
    ).toBeVisible();
    await dialog.getByRole("combobox").press("ArrowDown");
    await dialog.getByRole("combobox").press("Enter");
    await expect(page).toHaveURL(/\/papers\//);
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  }
  if (check === "finder") {
    const finder = page.getByRole("form", {
      name: "Find your paper in 3 steps",
    });
    await expect(finder).toBeVisible();
    const branch = finder.getByLabel("Branch", { exact: true });
    await branch.selectOption({ label: "CSE" });
    await finder
      .getByLabel("Semester", { exact: true })
      .selectOption({ label: "Semester 3" });
    await finder
      .getByLabel("Subject", { exact: true })
      .selectOption({ index: 1 });
    await branch.selectOption({ label: "ECE" });
    await expect(finder.getByLabel("Semester", { exact: true })).toHaveValue(
      "",
    );
    await expect(finder.getByLabel("Subject", { exact: true })).toHaveValue("");
    await expect(
      finder.getByRole("button", { name: "Find my papers" }),
    ).toBeDisabled();
    await branch.selectOption({ label: "CSE" });
    await finder
      .getByLabel("Semester", { exact: true })
      .selectOption({ label: "Semester 3" });
    await finder
      .getByLabel("Subject", { exact: true })
      .selectOption({ index: 1 });
    await finder.getByRole("button", { name: "Find my papers" }).click();
    await expect(page).toHaveURL(/\/subjects\/btech\/cse\/sem-3\//);
    await page.goto(base);
    const card = page
      .locator(".branch-card")
      .filter({ has: page.getByRole("link", { name: /^CSE/ }) });
    await card.getByRole("button", { name: /semester/i }).click();
    await card.getByRole("link", { name: "Semester 3", exact: true }).click();
    await expect(page).toHaveURL(/\/programs\/btech\/cse\?semester=/);
  }
  if (check === "cards") {
    await page.goto(base + "/papers");
    const card = page.locator(".resource").first();
    let downloads = 0;
    await page.route("**/download", async (route) => {
      downloads++;
      assert.equal(route.request().method(), "POST");
      assert.match(
        route.request().headers()["idempotency-key"],
        /^[a-f0-9-]{36}$/,
      );
      await new Promise((r) => setTimeout(r, 350));
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Download temporarily unavailable." },
        }),
      });
    });
    await card.getByRole("button", { name: "Quick preview" }).click();
    const preview = page.getByRole("dialog", { name: /Preview:/ });
    await expect(preview.locator("iframe")).toHaveAttribute(
      "src",
      /\/papers\/.+\/preview$/,
    );
    assert.equal(downloads, 0, "Preview must not count as a download");
    await page.keyboard.press("Escape");
    await expect(preview).not.toBeVisible();
    await expect(
      card.getByRole("button", { name: "Quick preview" }),
    ).toBeFocused();
    await card.getByRole("button", { name: "Quick download" }).click();
    await expect(
      card.getByRole("button", { name: "Quick download" }),
    ).toBeDisabled();
    await expect(card.getByRole("alert")).toContainText(
      "Download temporarily unavailable.",
    );
    assert.equal(downloads, 1);
    await expect(
      card.getByRole("button", { name: "Quick download" }),
    ).toBeEnabled();
  }
  if (check === "filters") {
    await page.goto(base + "/papers?q=CSE&year=2023");
    await expect(page.getByLabel("Branch", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: /Filters/ }).click();
    await page
      .getByLabel("Branch", { exact: true })
      .selectOption({ label: "CSE" });
    await page
      .getByLabel("Semester", { exact: true })
      .selectOption({ label: "Semester 3" });
    await expect(page).toHaveURL(/q=CSE/);
    await expect(page).toHaveURL(/year=2023/);
    await page
      .getByRole("button", { name: "Show results", exact: true })
      .click();
    await expect(page.getByLabel("Branch", { exact: true })).not.toBeVisible();
    await expect(page.locator(".resource").first()).toBeVisible();
    await page.getByRole("button", { name: "Remove year filter" }).click();
    assert.equal(new URL(page.url()).searchParams.has("year"), false);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Remove semester filter" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Filters/ }).click();
    await page
      .getByLabel("Branch", { exact: true })
      .selectOption({ label: "ECE" });
    assert.equal(new URL(page.url()).searchParams.has("semester"), false);
  }
  if (check === "theme") {
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.goto(base + "/admin/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // With no saved choice, the first visit follows the operating system.
    const light = await browser.newContext({ colorScheme: "light" });
    const fresh = await light.newPage();
    await fresh.goto(base);
    await expect(fresh.locator("html")).toHaveAttribute("data-theme", "light");
    await light.close();
  }
  if (check === "palette-focus") {
    await page
      .getByRole("button", { name: "Open search", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Search library" });
    await dialog.getByRole("combobox").fill("CSE");
    await expect(
      dialog.getByRole("option", { name: /CSE-/ }).first(),
    ).toBeVisible();
    await dialog.getByRole("combobox").press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Search papers" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close search" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Search papers" }),
    ).toBeFocused();
  }
  if (check === "search-empty") {
    const input = page.getByRole("combobox", {
      name: "Search subjects, codes or year",
    });
    await input.fill("zz-no-subject-4729");
    await expect(
      page.getByText("No subject match. Press Enter to search all resources."),
    ).toBeVisible();
    await input.press("ArrowUp");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/papers\?q=zz-no-subject-4729$/);
  }
  if (check === "search-races") {
    await page.route("**/api/papers?*", async (route) => {
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ response });
    });
    await page
      .getByRole("button", { name: "Open search", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Search library" });
    await dialog.getByRole("combobox").fill("CSE");
    const branch = dialog.getByRole("option", {
      name: /Computer Science and Engineering/,
    });
    await expect(branch).toBeVisible();
    await dialog.getByRole("combobox").press("ArrowDown");
    await expect(branch).toHaveAttribute("aria-selected", "true");
    await expect(
      dialog.getByRole("option", { name: /CSE-/ }).first(),
    ).toBeVisible();
    await expect(branch).toHaveAttribute("aria-selected", "true");
    await dialog.getByRole("combobox").press("Enter");
    await expect(page).toHaveURL(/\/papers\?branch=/);
    await page.goto(base);
    const input = page.getByRole("combobox", {
      name: "Search subjects, codes or year",
    });
    await input.fill("CSE-303");
    await expect(page.getByRole("option").first()).toBeVisible();
    await input.fill("new-query-4729");
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/papers\?q=new-query-4729$/);
  }
  assert.deepEqual(errors, []);
  console.log(`${check}: passed`);
} finally {
  await browser.close();
}
