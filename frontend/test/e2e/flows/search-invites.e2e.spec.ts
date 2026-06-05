import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { addOverride, createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";
import { fulfillJson } from "../helpers/fulfill";

const FLOW = "search-invites";

test.describe("Search @screenshot", () => {
  test("search minimum length prompt @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search");

    await expect(page.getByText("Enter at least 2 characters to start searching.")).toBeVisible();
    await snap(page, FLOW, "search-empty-prompt");
  });

  test("search loading state @screenshot", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      if (url.pathname === "/api/search") {
        await new Promise((r) => setTimeout(r, 2000));
        await fulfillJson(route, 200, { query: "plan", totalCount: 0, results: [] });
        return true;
      }
    });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=plan");
    await page.waitForTimeout(350);

    await snap(page, FLOW, "search-loading");
  });

  test("search no results @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=xyz");

    await expect(page.getByText(/No results found/)).toBeVisible();
    await snap(page, FLOW, "search-no-results");
  });

  test("search file results @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=plan");

    // Names live in tile tooltips now; the library heading is the visible anchor.
    await expect(page.getByRole("heading", { name: "Photos 2025" })).toBeVisible();
    await snap(page, FLOW, "search-file-results");
  });

  test("search folder results @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=folder");

    await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
    await snap(page, FLOW, "search-folder-results");
  });

  test("search mixed results @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=mix");

    await expect(page.getByRole("heading", { name: "Photos 2025" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
    await snap(page, FLOW, "search-mixed-results");
  });
});

test.describe("Search dark theme @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("search file results dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/search?q=plan");

    await expect(page.getByRole("heading", { name: "Photos 2025" })).toBeVisible();
    await snap(page, FLOW, "search-file-results-dark");
  });
});

test.describe("Invites @screenshot", () => {
  test("invite pending @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/invites/test-token");

    await expect(
      page.getByText("Accept this invitation to get access to the library."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept Invite" })).toBeVisible();
    await snap(page, FLOW, "invite-pending");
  });

  test("invite revoked @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/invites/revoked-token");

    await expect(page.getByText("This invitation was revoked by a library admin.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept Invite" })).toHaveCount(0);
    await snap(page, FLOW, "invite-revoked");
  });

  test("invite accepted @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/invites/test-token");
    await page.getByRole("button", { name: "Accept Invite" }).click();

    await expect(page).toHaveURL(/\/libraries\/lib-photos/);
    await snap(page, FLOW, "invite-accepted");
  });
});

test.describe("Invites dark theme @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("invite pending dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/invites/test-token");

    await expect(
      page.getByText("Accept this invitation to get access to the library."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept Invite" })).toBeVisible();
    await snap(page, FLOW, "invite-pending-dark");
  });
});
