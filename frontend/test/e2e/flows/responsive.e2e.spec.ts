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

    await expect(page.getByRole("heading", { name: "Photos 2025" })).toBeVisible();
    await snap(page, FLOW, "mobile-library-header");
  });

  test("mobile search @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=plan");

    await expect(page.getByText("Quarterly Plan.pdf")).toBeVisible();
    await snap(page, FLOW, "mobile-search");
  });
});
