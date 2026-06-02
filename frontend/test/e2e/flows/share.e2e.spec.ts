import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { addOverride, createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";

const FLOW = "share";

// The /s/** share pages are SSR-rendered (routeRules), so their metadata fetch
// happens on the Nitro server and is served by the deterministic mock backend
// (see test/e2e/helpers/mock-backend.mjs + playwright.config.ts). The token
// selects the scenario:
//   ready-token       -> ready moment with video
//   processing-token  -> still encoding (no video)
//   missing-token     -> 404 (share not found)
//
// page.route() still mocks the binary thumbnail/video so the <video> poster is
// deterministic on the client.
const READY_TOKEN = "ready-token";
const PROCESSING_TOKEN = "processing-token";
const MISSING_TOKEN = "missing-token";

function mockShareBinaries(state: ReturnType<typeof createDefaultState>) {
  addOverride(state, async (route, url) => {
    if (/^\/api\/share\/[\w-]+\/(thumbnail|video)$/.test(url.pathname)) {
      const pngBuffer = Buffer.from(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082",
        "hex",
      );
      await route.fulfill({ status: 200, contentType: "image/png", body: pngBuffer });
      return true;
    }
  });
}

test.describe("Share @screenshot", () => {
  test("share moment @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockShareBinaries(state);
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto(`/s/${READY_TOKEN}`);

    await expect(page.getByRole("heading", { name: "Sunset over the bay" })).toBeVisible();
    await expect(page.locator("video")).toBeVisible();
    await snap(page, FLOW, "share-moment");
  });

  test("share moment processing @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockShareBinaries(state);
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto(`/s/${PROCESSING_TOKEN}`);

    await expect(page.getByText("Still processing.")).toBeVisible();
    await snap(page, FLOW, "share-moment-processing");
  });

  test("share not found @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockShareBinaries(state);
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto(`/s/${MISSING_TOKEN}`);

    // Page throws a fatal createError(404) -> Nuxt error page.
    await expect(page.getByRole("heading", { name: "Share not found" })).toBeVisible();
    await snap(page, FLOW, "share-not-found");
  });
});

test.describe("Share dark theme @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("share moment dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockShareBinaries(state);
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto(`/s/${READY_TOKEN}`);

    await expect(page.getByRole("heading", { name: "Sunset over the bay" })).toBeVisible();
    await expect(page.locator("video")).toBeVisible();
    await snap(page, FLOW, "share-moment-dark");
  });
});
