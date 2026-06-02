import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { addOverride, createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";
import { fulfillJson } from "../helpers/fulfill";

const FLOW = "library-browser";

async function primeEntryView(page: import("@playwright/test").Page, mode: "file" | "card") {
  await page.addInitScript((m: string) => {
    try {
      localStorage.setItem("alcoves.library.entry-view", m);
    } catch {
      // ignore
    }
  }, mode);
}

test.describe("Library browser @screenshot", () => {
  test("home redirects to default library @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/");

    await expect(page).toHaveURL(/\/libraries\/lib-personal/);
    await snap(page, FLOW, "home-redirects");
  });

  test("library empty state @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.folders = [];
    state.files = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-personal");

    await expect(page.getByRole("tab", { name: /Files/ })).toBeVisible();
    await snap(page, FLOW, "library-empty");
  });

  test("library loading skeleton @screenshot", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      if (/^\/api\/libraries\/[\w-]+\/files$/.test(url.pathname)) {
        await new Promise((r) => setTimeout(r, 2500));
        await fulfillJson(route, 200, {
          entries: [],
          breadcrumbs: [],
          nextCursor: null,
          totalCount: 0,
        });
        return true;
      }
    });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");
    await page.waitForTimeout(500);

    await snap(page, FLOW, "library-loading-skeleton");
  });

  test("library table view @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await expect(page.getByText("sunset.jpg")).toBeVisible();
    await snap(page, FLOW, "library-list-view");
  });

  test("library grid view @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "card");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await snap(page, FLOW, "library-grid-view");
  });

  test("library grid large thumbnails @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "card");
    await page.addInitScript(() => {
      try {
        localStorage.setItem("alcoves.library.card-thumb-width", "320");
        localStorage.setItem("alcoves.library.card-thumb-height", "240");
      } catch {
        // ignore
      }
    });
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await snap(page, FLOW, "library-grid-large-thumbnails");
  });

  test("library breadcrumbs in nested folder @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.folders.push({
      id: "folder-nested",
      libraryId: "lib-photos",
      parentFolderId: "folder-vacation",
      name: "Beach Day",
      kind: "folder",
      trashedAt: null,
      createdAt: "2025-07-20T00:00:00.000Z",
      updatedAt: "2026-01-15T12:00:00.000Z",
      owner: null,
      tags: [],
    });
    await setupDeterminism(page);
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos?folder=folder-vacation");

    await expect(page.getByText("Beach Day")).toBeVisible();
    await snap(page, FLOW, "library-breadcrumbs-nested");
  });

  test("library selection single @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    const firstRow = page.getByText("sunset.jpg");
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await snap(page, FLOW, "library-selection-single");
  });

  test("library selection multi @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await page.getByText("sunset.jpg").click();
    await page.getByText("portrait.png").click({ modifiers: ["Shift"] });
    await snap(page, FLOW, "library-selection-multi");
  });

  test("library sort by name @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos?sort=name&order=desc");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await snap(page, FLOW, "library-sort-name-desc");
  });

  test("library sort by updated @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos?sort=updatedAt&order=desc");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await snap(page, FLOW, "library-sort-updated");
  });

  test("library trash empty @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.folders = state.folders.filter((f) => !f.trashedAt);
    state.files = state.files.filter((f) => !f.trashedAt);
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/trash");

    await expect(page.getByRole("tab", { name: /Trash/ })).toBeVisible();
    await snap(page, FLOW, "library-trash-empty");
  });

  test("library trash items @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/trash");

    await expect(page.getByRole("tab", { name: /Trash/ })).toBeVisible();
    await snap(page, FLOW, "library-trash-items");
  });

  test("library auth redirect @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos", { waitUntil: "networkidle" });

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Library browser dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("library grid dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await primeEntryView(page, "card");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await snap(page, FLOW, "library-grid-view-dark");
  });

  test("library list dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await primeEntryView(page, "file");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await expect(page.getByText("sunset.jpg")).toBeVisible();
    await snap(page, FLOW, "library-list-view-dark");
  });
});
