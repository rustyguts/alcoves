import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "modals";

test.describe("Modals @screenshot", () => {
  test("upload modal empty @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.folders = [];
    state.files = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    const uploadBtn = page
      .getByRole("button", { name: /upload files/i })
      .or(page.getByRole("button", { name: /upload/i }))
      .first();
    if ((await uploadBtn.count()) > 0) {
      await uploadBtn.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(200);
    }
    await snap(page, FLOW, "upload-modal-empty");
  });

  test("upload modal via new dropdown @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await page.waitForTimeout(200);
    const newBtn = page
      .getByRole("button", { name: /^new$/i })
      .or(page.locator("button").filter({ hasText: "New" }))
      .first();
    if ((await newBtn.count()) > 0) {
      await newBtn.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(150);
    }
    await snap(page, FLOW, "upload-new-menu");
  });

  test("emoji picker open @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByTitle("Choose emoji icon")).toBeVisible();
    await page.getByTitle("Choose emoji icon").click();
    await expect(page.getByText("Pick an icon")).toBeVisible();
    await snap(page, FLOW, "emoji-picker-open");
  });

  test("confirm delete (face rec disable) @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    const faceSwitch = page.getByRole("switch").first();
    await faceSwitch.click();
    await expect(page.getByText(/Disable Facial Recognition/i).first()).toBeVisible();
    await snap(page, FLOW, "confirm-delete");
  });

  test("confirm warning (face rec reprocess) @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    const reprocessBtn = page.getByRole("button", { name: /Reprocess Faces/i });
    await expect(reprocessBtn).toBeVisible();
    await reprocessBtn.click();
    await expect(page.getByText(/Reprocess Facial Recognition/i).first()).toBeVisible();
    await snap(page, FLOW, "confirm-warning");
  });

  test("confirm delete library @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const deleteBtn = page.getByRole("button", { name: "Delete", exact: true });
    if ((await deleteBtn.count()) > 0) {
      await deleteBtn.click().catch(() => undefined);
      await page.waitForTimeout(200);
    }
    await snap(page, FLOW, "confirm-delete-library");
  });

  test("create folder modal @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await page.waitForTimeout(200);
    const newBtn = page.locator("button").filter({ hasText: "New" }).first();
    if ((await newBtn.count()) > 0) {
      await newBtn.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(150);
      const folderItem = page
        .getByRole("menuitem", { name: /folder/i })
        .or(page.getByText(/new folder/i))
        .first();
      if ((await folderItem.count()) > 0) {
        await folderItem.click({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(200);
      }
    }
    await snap(page, FLOW, "create-folder-modal");
  });

  test("file preview image @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("sunset.jpg")).toBeVisible();
    await page.getByText("sunset.jpg").dblclick();
    await page.waitForTimeout(300);
    await snap(page, FLOW, "file-preview-image");
  });

  test("file preview video @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("road-trip.mp4")).toBeVisible();
    await page.getByText("road-trip.mp4").dblclick();
    await page.waitForTimeout(300);
    await snap(page, FLOW, "file-preview-video");
  });

  test("context menu folder @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("Vacation 2025")).toBeVisible();
    await page.getByText("Vacation 2025").click({ button: "right" });
    await page.waitForTimeout(200);
    await snap(page, FLOW, "context-menu-folder");
  });

  test("context menu file multi @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByText("sunset.jpg")).toBeVisible();
    await page.getByText("sunset.jpg").click();
    await page.getByText("portrait.png").click({ modifiers: ["Shift"] });
    await page.getByText("sunset.jpg").click({ button: "right" });
    await page.waitForTimeout(200);
    await snap(page, FLOW, "context-menu-file-multi");
  });
});

test.describe("Modals dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("confirm delete dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/settings");

    const faceSwitch = page.getByRole("switch").first();
    await faceSwitch.click();
    await expect(page.getByText(/Disable Facial Recognition/i).first()).toBeVisible();
    await snap(page, FLOW, "confirm-delete-dark");
  });

  test("emoji picker open dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await page.getByTitle("Choose emoji icon").click();
    await snap(page, FLOW, "emoji-picker-open-dark");
  });
});
