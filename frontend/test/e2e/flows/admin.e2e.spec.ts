import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { addOverride, createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";
import { fulfillJson } from "../helpers/fulfill";

const FLOW = "admin";

test.describe("Admin @screenshot", () => {
  test("admin dashboard stats @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
    // Scope to the page's <main> landmark: the sidebar library nav also renders a
    // "Files" action item, so an unscoped exact-text match is ambiguous.
    const content = page.getByRole("main");
    await expect(content.getByText("Files", { exact: true })).toBeVisible();
    await expect(content.getByText("Storage", { exact: true })).toBeVisible();
    await snap(page, FLOW, "admin-dashboard-stats");
  });

  test("admin users table @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin");

    await expect(page.getByText("Morgan Member").first()).toBeVisible();
    await expect(page.getByText("Jamie Viewer").first()).toBeVisible();
    await snap(page, FLOW, "admin-users-table");
  });

  test("admin role dropdown open @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin");

    await expect(page.getByText("Morgan Member").first()).toBeVisible();
    const trigger = page
      .locator("tbody tr")
      .filter({ hasText: "Morgan Member" })
      .locator("button, [role='combobox'], select")
      .first();
    if ((await trigger.count()) > 0) {
      await trigger.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(200);
    }
    await snap(page, FLOW, "admin-role-dropdown-open");
  });

  test("admin non-owner redirect @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.currentUser = { ...state.currentUser, role: "member" };
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin", { waitUntil: "networkidle" });

    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("admin jobs connected @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin/jobs");

    await expect(page.getByRole("heading", { name: "Background Jobs" })).toBeVisible();
    await expect(page.getByText("transcode", { exact: false }).first()).toBeVisible();
    await snap(page, FLOW, "admin-jobs-connected");
  });

  test("admin jobs empty @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.queues = [];
    state.jobs = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin/jobs");

    await expect(page.getByRole("heading", { name: "Background Jobs" })).toBeVisible();
    await snap(page, FLOW, "admin-jobs-empty");
  });

  test("admin jobs failed expanded @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin/jobs");

    await expect(page.getByRole("heading", { name: "Background Jobs" })).toBeVisible();
    const failedRow = page.locator("tr").filter({ hasText: "failed" }).first();
    if ((await failedRow.count()) > 0) {
      await failedRow.click();
      await page.waitForTimeout(150);
    }
    await snap(page, FLOW, "admin-jobs-failed");
  });

  test("admin jobs disconnected @screenshot", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      if (url.pathname === "/api/admin/jobs/stream") {
        await fulfillJson(route, 503, { message: "Stream unavailable" });
        return true;
      }
    });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/admin/jobs");

    await expect(page.getByRole("heading", { name: "Background Jobs" })).toBeVisible();
    await page.waitForTimeout(400);
    await snap(page, FLOW, "admin-jobs-disconnected");
  });
});

test.describe("Admin dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("admin dashboard stats dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
    await snap(page, FLOW, "admin-dashboard-stats-dark");
  });

  test("admin jobs connected dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/admin/jobs");

    await expect(page.getByRole("heading", { name: "Background Jobs" })).toBeVisible();
    await expect(page.getByText("transcode", { exact: false }).first()).toBeVisible();
    await snap(page, FLOW, "admin-jobs-connected-dark");
  });
});
