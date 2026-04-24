import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "auth";

test.describe("Auth flows @screenshot", () => {
  test("login empty state @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false, googleAuthEnabled: true });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await snap(page, FLOW, "login-empty");
  });

  test("login filled form @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/login");

    await page.getByRole("textbox", { name: "Email" }).fill("owner@example.com");
    await page.getByLabel("Password").fill("password123");
    await snap(page, FLOW, "login-filled");
  });

  test("login google error @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false, googleAuthEnabled: true });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/login?error=google");

    await expect(page.getByText("Google sign-in failed. Please try again.")).toBeVisible();
    await snap(page, FLOW, "login-google-error");
  });

  test("login api error @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/login");

    await page.getByRole("textbox", { name: "Email" }).fill("bad@example.com");
    await page.getByLabel("Password").fill("wrongpass");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await snap(page, FLOW, "login-api-error");
  });

  test("login redirect from protected route @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/search?q=plan", { waitUntil: "networkidle" });

    await expect(page).toHaveURL(/\/login\?redirect=/);
    await snap(page, FLOW, "login-redirect");
  });

  test("login cross link preserves redirect @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/login?redirect=/search");

    await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/register?redirect=/search",
    );
    await snap(page, FLOW, "login-cross-links");
  });

  test("login success redirects to search @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/login?redirect=%2Fsearch%3Fq%3Dplan");
    await page.getByRole("textbox", { name: "Email" }).fill("owner@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/search\?q=plan/);
    await snap(page, FLOW, "login-success-redirect");
  });

  test("register empty state @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/register");

    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await snap(page, FLOW, "register-empty");
  });

  test("register filled form @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/register");

    await page.getByRole("textbox", { name: "Name" }).fill("New User");
    await page.getByRole("textbox", { name: "Email" }).fill("new@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");
    await snap(page, FLOW, "register-filled");
  });

  test("register password mismatch @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/register");

    await page.getByRole("textbox", { name: "Name" }).fill("New User");
    await page.getByRole("textbox", { name: "Email" }).fill("new@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("mismatch1");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText("Passwords do not match")).toBeVisible();
    await snap(page, FLOW, "register-password-mismatch");
  });

  test("register cross link preserves redirect @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/register?redirect=/search");

    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?redirect=/search",
    );
    await snap(page, FLOW, "register-cross-links");
  });
});

test.describe("Auth dark theme @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("login empty dark @screenshot", async ({ page }) => {
    const state = createDefaultState({ loggedIn: false, googleAuthEnabled: true });
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await snap(page, FLOW, "login-empty-dark");
  });
});
