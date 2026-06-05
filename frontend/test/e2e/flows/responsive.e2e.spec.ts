import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "responsive";

test.use({ viewport: { width: 375, height: 812 } });

test.describe("Mobile @screenshot", () => {
  test("mobile login @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false, googleAuthEnabled: true });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await snap(page, FLOW, "mobile-login");
  });

  test("mobile login dark @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false, googleAuthEnabled: true });
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await snap(page, FLOW, "mobile-login dark");
  });

  test("mobile register @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/register");

    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await snap(page, FLOW, "mobile-register");
  });

  test("mobile profile @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
    await snap(page, FLOW, "mobile-profile");
  });

  test("mobile library grid @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await page.addInitScript(() => {
      try {
        localStorage.setItem("alcoves.library.entry-view", "card");
      } catch {
        // ignore
      }
    });
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await snap(page, FLOW, "mobile-library-grid");
  });

  test("mobile library header @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    // Tabs now live in the sidebar (behind the mobile hamburger), so gate on the
    // breadcrumb library name to confirm the library chrome rendered. The sidebar
    // library switcher renders the same name (and the mobile slideover keeps it in
    // the DOM), so scope to the breadcrumb nav to avoid a strict-mode match of two
    // elements once the libraries list populates.
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Photos 2025", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await snap(page, FLOW, "mobile-library-header");
  });

  test("mobile sidebar with nested library tabs @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");
    // Wait for the library chrome to hydrate (and the libraries list to load)
    // before opening the slideover, so the nested nav is populated. Scope to the
    // breadcrumb nav — the sidebar switcher renders the same name and would make
    // a bare getByText match two elements.
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Photos 2025", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Open the hamburger slideover; the active library expands to reveal its
    // sections (Files / Timeline / … / Settings / Trash) as nested nav items.
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(page.getByRole("link", { name: "Files" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    await snap(page, FLOW, "mobile-sidebar-nav");
  });

  test("mobile search @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=plan");

    // Result names live in tile tooltips now; assert on the library heading.
    await expect(page.getByRole("heading", { name: "Photos 2025" })).toBeVisible();
    await snap(page, FLOW, "mobile-search");
  });
});
