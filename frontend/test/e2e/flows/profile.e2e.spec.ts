import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "profile";

test.describe("Profile @screenshot", () => {
  test("profile overview @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    await expect(page.getByText("owner@example.com")).toBeVisible();
    await expect(page.getByText("Appearance")).toBeVisible();
    await snap(page, FLOW, "profile-overview");
  });

  test("profile edit form @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    const nameInput = page.getByPlaceholder("Display name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Alex Updated");
    await snap(page, FLOW, "profile-edit-form");
  });

  test("profile sessions @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
    await expect(page.getByText(/Chrome/)).toBeVisible();
    await snap(page, FLOW, "profile-sessions");
  });

  test("profile session revoke confirm @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    const revokeBtn = page.getByRole("button", { name: /revoke/i }).first();
    await expect(revokeBtn).toBeVisible();
    await revokeBtn.hover();
    await snap(page, FLOW, "profile-session-revoke-confirm");
  });

  test("profile access tokens @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: "MCP access tokens" })).toBeVisible();
    await expect(page.getByText("Claude Desktop (laptop)")).toBeVisible();
    await snap(page, FLOW, "profile-access-tokens");
  });

  test("profile access token created modal @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    await page.getByPlaceholder("e.g. Claude Desktop on laptop").fill("CI token");
    await page.getByRole("button", { name: /Create token/ }).click();
    await expect(page.getByText("Copy your new token")).toBeVisible();
    await snap(page, FLOW, "profile-access-token-created");
  });

  test("profile appearance theme picker @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile");

    await expect(page.getByRole("button", { name: /Dark/ })).toBeVisible();
    await snap(page, FLOW, "profile-appearance");
  });

  test("profile unauth redirect @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/profile", { waitUntil: "networkidle" });

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Profile dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("profile overview dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/profile");

    await expect(page.getByText("owner@example.com")).toBeVisible();
    await snap(page, FLOW, "profile-overview-dark");
  });

  test("profile edit form dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/profile");

    const nameInput = page.getByPlaceholder("Display name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill("Alex Updated");
    await expect(page.getByRole("button", { name: /Save changes/ })).toBeEnabled();
    await snap(page, FLOW, "profile-edit-form-dark");
  });
});
