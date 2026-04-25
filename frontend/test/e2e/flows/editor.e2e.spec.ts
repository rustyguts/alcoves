import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { createMockApi } from "../helpers/mock-api";
import { setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "editor";

test.describe("Video editor @screenshot", () => {
  test("empty editor page for a video @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);

    // Editor page for a video file (file-vid-1 from default state).
    await page.goto("/libraries/lib-photos/edit/file-vid-1");

    await expect(page.getByRole("button", { name: /New moment/i })).toBeVisible();
    await expect(page.getByText(/No moments yet/)).toBeVisible();
    await snap(page, FLOW, "editor-empty");
  });

  test("create a moment and see it on timeline + panel @screenshot", async ({ page }) => {
    const state = createDefaultState();
    // Pre-seed a moment so we don't rely on the video actually loading (vidstack player
    // is client-only; the timeline will still render even if duration is 0).
    state.moments = [
      {
        id: "moment-1",
        libraryId: "lib-photos",
        fileId: "file-vid-1",
        createdById: "user-owner",
        name: "Opening shot",
        description: "Wide angle establishing the scene",
        startSeconds: 2,
        endSeconds: 8,
        exportStatus: null,
        exportProgress: null,
        exportEtaSeconds: null,
        exportVersion: 1,
        exportedVersion: null,
        trashedAt: null,
        createdAt: "2026-01-15T12:00:00.000Z",
        updatedAt: "2026-01-15T12:00:00.000Z",
        tags: [],
      },
    ];
    await setupDeterminism(page);
    await createMockApi(page, state);

    await page.goto("/libraries/lib-photos/edit/file-vid-1");

    // Sidebar list renders the moment name.
    await expect(page.getByText("Opening shot")).toBeVisible();
    // Duration "6.00s".
    await expect(page.getByText(/6\.00s/).first()).toBeVisible();
    await snap(page, FLOW, "editor-with-moment");
  });
});
