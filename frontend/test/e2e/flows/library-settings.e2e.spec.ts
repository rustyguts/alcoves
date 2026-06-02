import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "library-settings";

test.describe("Library settings @screenshot", () => {
  test("settings general @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Library Name")).toBeVisible();
    await snap(page, FLOW, "settings-general");
  });

  test("settings features on @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Facial Recognition", { exact: true })).toBeVisible();
    await expect(page.getByText("Object Detection", { exact: true })).toBeVisible();
    await snap(page, FLOW, "settings-features-on");
  });

  test("settings features off @screenshot", async ({ page }) => {
    const state = createDefaultState();
    const photos = state.libraries.find((l) => l.id === "lib-photos")!;
    photos.faceRecognitionEnabled = false;
    photos.objectDetectionEnabled = false;
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Facial Recognition", { exact: true })).toBeVisible();
    await snap(page, FLOW, "settings-features-off");
  });

  test("settings members empty @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.members = state.members.filter((m) => m.role === "owner");
    state.invites = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Library Members")).toBeVisible();
    await snap(page, FLOW, "settings-members-empty");
  });

  test("settings members populated @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Morgan Editor").first()).toBeVisible();
    await expect(page.getByText("Sam Editor").first()).toBeVisible();
    await snap(page, FLOW, "settings-members-populated");
  });

  test("settings invites pending @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Library Members")).toBeVisible();
    await snap(page, FLOW, "settings-invites-pending");
  });

  test("settings invites revoked @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.invites = state.invites.filter((i) => i.status !== "pending");
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Library Members")).toBeVisible();
    await snap(page, FLOW, "settings-invites-revoked");
  });

  test("settings danger zone @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByText("Delete Library")).toBeVisible();
    await snap(page, FLOW, "settings-danger-zone");
  });
});

test.describe("Library tags @screenshot", () => {
  test("tags empty @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.tags = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/tags");

    await expect(page.getByRole("heading", { name: "Manage Tags" })).toBeVisible();
    await expect(page.getByText("No tags yet")).toBeVisible();
    await snap(page, FLOW, "tags-empty");
  });

  test("tags populated @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/tags");

    await expect(page.getByRole("heading", { name: "Manage Tags" })).toBeVisible();
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await snap(page, FLOW, "tags-populated");
  });

  test("tags color picker open @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/tags");

    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await page.locator("[data-color-dropdown]").first().click();
    await page.waitForTimeout(150);
    await snap(page, FLOW, "tags-color-picker-open");
  });

  test("tags new input @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/tags");

    const newInput = page.getByPlaceholder("New tag");
    await expect(newInput).toBeVisible();
    await newInput.fill("Summer");
    await snap(page, FLOW, "tags-new-input");
  });
});

test.describe("Library settings dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("settings general dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Library Name")).toBeVisible();
    await snap(page, FLOW, "settings-general-dark");
  });

  test("tags populated dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/tags");

    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await snap(page, FLOW, "tags-populated-dark");
  });

  test("settings members populated dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await expect(page.getByText("Morgan Editor").first()).toBeVisible();
    await expect(page.getByText("Sam Editor").first()).toBeVisible();
    await snap(page, FLOW, "settings-members-populated-dark");
  });
});
