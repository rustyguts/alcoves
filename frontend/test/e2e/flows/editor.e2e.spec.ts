import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

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

    // Moment name appears both on the timeline label and in the sidebar list,
    // so target the sidebar role=button to keep the assertion unambiguous.
    await expect(page.getByRole("button", { name: /Opening shot/i })).toBeVisible();
    // Duration "6.00s".
    await expect(page.getByText(/6\.00s/).first()).toBeVisible();
    await snap(page, FLOW, "editor-with-moment");
  });

  test("editor renders waveform when status is ready @screenshot", async ({ page }) => {
    const state = createDefaultState();
    // Synthetic envelope-shaped peaks (600 samples = 12s @ 50 pps) so the
    // canvas renders a recognisable shape, not flat.
    const peaks: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t = i / 600;
      peaks.push(Math.abs(Math.sin(t * Math.PI * 4)) * (0.4 + 0.5 * Math.sin(t * Math.PI)));
    }
    const vid = state.files.find((f) => f.id === "file-vid-1");
    if (vid) {
      vid.waveformStatus = "ready";
      vid.waveformPeaksPerSecond = 50;
      vid.waveformPeaks = peaks;
    }

    await setupDeterminism(page);
    await createMockApi(page, state);

    await page.goto("/libraries/lib-photos/edit/file-vid-1");

    await expect(page.getByRole("button", { name: /Regenerate waveform/i })).toBeVisible();
    await expect(page.locator("canvas.waveform-canvas")).toBeVisible();
    await snap(page, FLOW, "editor-with-waveform");
  });

  test("waveform button toggles to retry on failed status @screenshot", async ({ page }) => {
    const state = createDefaultState();
    const vid = state.files.find((f) => f.id === "file-vid-1");
    if (vid) {
      vid.waveformStatus = "failed";
    }

    await setupDeterminism(page);
    await createMockApi(page, state);

    await page.goto("/libraries/lib-photos/edit/file-vid-1");

    await expect(page.getByRole("button", { name: /Retry waveform/i })).toBeVisible();
    await expect(page.locator("canvas.waveform-canvas")).toHaveCount(0);
    await snap(page, FLOW, "editor-waveform-failed");
  });
});

test.describe("Video editor dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("empty editor page for a video dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);

    // Primary editor view (file-vid-1 from default state) in dark mode.
    await page.goto("/libraries/lib-photos/edit/file-vid-1");

    await expect(page.getByRole("button", { name: /New moment/i })).toBeVisible();
    await expect(page.getByText(/No moments yet/)).toBeVisible();
    await snap(page, FLOW, "editor-empty-dark");
  });

  test("editor renders waveform when status is ready dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    // Synthetic envelope-shaped peaks (600 samples = 12s @ 50 pps) so the
    // canvas renders a recognisable shape, not flat.
    const peaks: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t = i / 600;
      peaks.push(Math.abs(Math.sin(t * Math.PI * 4)) * (0.4 + 0.5 * Math.sin(t * Math.PI)));
    }
    const vid = state.files.find((f) => f.id === "file-vid-1");
    if (vid) {
      vid.waveformStatus = "ready";
      vid.waveformPeaksPerSecond = 50;
      vid.waveformPeaks = peaks;
    }

    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);

    await page.goto("/libraries/lib-photos/edit/file-vid-1");

    await expect(page.getByRole("button", { name: /Regenerate waveform/i })).toBeVisible();
    await expect(page.locator("canvas.waveform-canvas")).toBeVisible();
    await snap(page, FLOW, "editor-with-waveform-dark");
  });
});
