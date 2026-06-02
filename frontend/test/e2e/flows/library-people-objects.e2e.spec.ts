import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { addOverride, createMockApi } from "../helpers/mock-api";
import { setTheme, setupDeterminism, snap } from "../helpers/screenshot";
import { fulfillJson } from "../helpers/fulfill";

const FLOW = "library-people-objects";

test.describe("People @screenshot", () => {
  test("people list @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/people");

    await expect(page.getByRole("tab", { name: /People/ })).toBeVisible();
    await snap(page, FLOW, "people-list");
  });

  test("people empty @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.people = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/people");

    await expect(page.getByText("No faces detected yet")).toBeVisible();
    await snap(page, FLOW, "people-empty");
  });

  test("people rename modal @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/people");

    await page.waitForTimeout(200);
    const tileCount = await page.locator("button[title]").count();
    if (tileCount > 0) {
      await page.locator("button[title]").first().click({ button: "right" });
      await page.waitForTimeout(200);
    }
    await snap(page, FLOW, "people-rename-modal");
  });

  test("people disabled @screenshot", async ({ page }) => {
    const state = createDefaultState();
    const photos = state.libraries.find((l) => l.id === "lib-photos")!;
    photos.faceRecognitionEnabled = false;
    state.people = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos");

    await expect(page.getByRole("tab", { name: /Files/ })).toBeVisible();
    await snap(page, FLOW, "people-disabled");
  });
});

test.describe("Objects @screenshot", () => {
  test("objects labels @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/objects");

    await expect(page.getByText("labels", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("person").first()).toBeVisible();
    await snap(page, FLOW, "objects-labels");
  });

  test("objects loading @screenshot", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      if (/^\/api\/libraries\/[\w-]+\/objects\/labels$/.test(url.pathname)) {
        await new Promise((r) => setTimeout(r, 2500));
        await fulfillJson(route, 200, { labels: [] });
        return true;
      }
    });
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/objects");
    await page.waitForTimeout(400);

    await snap(page, FLOW, "objects-loading");
  });

  test("objects empty @screenshot", async ({ page }) => {
    const state = createDefaultState();
    state.objectLabels = [];
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/objects");

    await expect(page.getByText("No objects detected yet")).toBeVisible();
    await snap(page, FLOW, "objects-empty");
  });
});

/**
 * The person-detail page (app/pages/libraries/[id]/people/[personId].vue) fetches
 * `GET /api/libraries/:id/people` and expects a bare array of LibraryPerson, then
 * `GET /api/libraries/:id/people/:personId/faces` expecting a bare array of PersonFace.
 * The default mock returns object-wrapped shapes for those routes, so we override
 * both with the array shapes the page consumes.
 */
function mockPersonDetail(state: ReturnType<typeof createDefaultState>) {
  const personList = state.people.map((p) => ({
    id: p.id,
    libraryId: p.libraryId,
    name: p.name,
    faceCount: p.faceCount,
    coverFaceDetectionId: null,
    createdAt: "2025-10-01T00:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
  }));
  const fileIds = ["file-img-1", "file-img-2", "file-img-3", "file-img-4"];
  const faces = Array.from({ length: 12 }, (_, i) => ({
    id: `face-${i + 1}`,
    fileId: fileIds[i % fileIds.length]!,
    fileName: `photo-${i + 1}.jpg`,
    boxX: 0.2,
    boxY: 0.2,
    boxWidth: 0.3,
    boxHeight: 0.3,
    imageWidth: 1000,
    imageHeight: 1000,
    confidence: 0.97,
    createdAt: "2025-10-01T00:00:00.000Z",
  }));

  addOverride(state, async (route, url) => {
    if (/^\/api\/libraries\/[\w-]+\/people$/.test(url.pathname)) {
      await fulfillJson(route, 200, personList);
      return true;
    }
    if (/^\/api\/libraries\/[\w-]+\/people\/[\w-]+\/faces$/.test(url.pathname)) {
      await fulfillJson(route, 200, faces);
      return true;
    }
  });
}

test.describe("Person detail @screenshot", () => {
  test("person detail @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockPersonDetail(state);
    await setupDeterminism(page);
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/people/person-1");

    await expect(page.getByText("Alex Owner")).toBeVisible();
    await expect(page.getByText("12 faces")).toBeVisible();
    await snap(page, FLOW, "person-detail");
  });
});

test.describe("Person detail dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("person detail dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    mockPersonDetail(state);
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/people/person-1");

    await expect(page.getByText("Alex Owner")).toBeVisible();
    await expect(page.getByText("12 faces")).toBeVisible();
    await snap(page, FLOW, "person-detail-dark");
  });
});

test.describe("People dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("people list dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/people");

    await expect(page.getByRole("tab", { name: /People/ })).toBeVisible();
    await snap(page, FLOW, "people-list-dark");
  });
});

test.describe("Objects dark @screenshot", () => {
  test.use({ colorScheme: "dark" });

  test("objects labels dark @screenshot", async ({ page }) => {
    const state = createDefaultState();
    await setupDeterminism(page);
    await setTheme(page, "dark");
    await createMockApi(page, state);
    await page.goto("/libraries/lib-photos/objects");

    await expect(page.getByText("labels", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("person").first()).toBeVisible();
    await snap(page, FLOW, "objects-labels-dark");
  });
});
