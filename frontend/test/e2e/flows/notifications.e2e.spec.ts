import { expect, test } from "@playwright/test";
import { createDefaultState } from "../helpers/default-state";
import { addOverride, createMockApi } from "../helpers/mock-api";
import { fulfillJson, fulfillEmpty } from "../helpers/fulfill";

// Sample activity rows returned by the override below.
const ACT_TAG = {
  id: "act-tag",
  libraryId: "lib-personal",
  libraryName: "Personal",
  actor: { id: "u-alice", displayName: "Alice", avatarUrl: null },
  action: "tag.created",
  subjectType: "tag",
  subjectId: "tag-1",
  metadata: { name: "vacation", color: "#3B82F6" },
  createdAt: "2026-05-12T06:00:00Z",
  dismissed: false,
};
const ACT_FILE = {
  id: "act-file",
  libraryId: "lib-personal",
  libraryName: "Personal",
  actor: { id: "u-alice", displayName: "Alice", avatarUrl: null },
  action: "file.created",
  subjectType: "file",
  subjectId: "file-1",
  metadata: { name: "photo.jpg", mimeType: "image/jpeg", parentFolderId: null, size: 1024 },
  createdAt: "2026-05-12T05:55:00Z",
  dismissed: false,
};

test.describe("Notifications flow", () => {
  test("bell badge reflects unread count", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      if (url.pathname === "/api/notifications/unread-count") {
        await fulfillJson(route, 200, { unreadCount: 3 });
        return true;
      }
      return false;
    });
    await createMockApi(page, state);
    await page.goto("/libraries/lib-personal");

    // Badge appears (caps still allow "3").
    await expect(page.getByLabel("Notifications")).toBeVisible();
    await expect(page.locator('button[aria-label="Notifications"] span').filter({ hasText: "3" })).toBeVisible();
  });

  test("opening the bell shows global notifications grouped per library", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      if (url.pathname === "/api/notifications" && route.request().method() === "GET") {
        await fulfillJson(route, 200, {
          entries: [ACT_TAG, ACT_FILE],
          nextCursor: null,
          unreadCount: 2,
        });
        return true;
      }
      if (url.pathname === "/api/notifications/unread-count") {
        await fulfillJson(route, 200, { unreadCount: 2 });
        return true;
      }
      return false;
    });
    await createMockApi(page, state);
    await page.goto("/libraries/lib-personal");

    await page.getByLabel("Notifications").click();

    await expect(page.getByText("Alice created tag vacation")).toBeVisible();
    await expect(page.getByText("Alice added photo.jpg")).toBeVisible();
  });

  test("dismiss all clears the bell", async ({ page }) => {
    const state = createDefaultState();
    let dismissAllCalled = false;
    addOverride(state, async (route, url) => {
      if (url.pathname === "/api/notifications" && route.request().method() === "GET") {
        await fulfillJson(route, 200, {
          entries: [ACT_TAG],
          nextCursor: null,
          unreadCount: dismissAllCalled ? 0 : 1,
        });
        return true;
      }
      if (url.pathname === "/api/notifications/unread-count") {
        await fulfillJson(route, 200, { unreadCount: dismissAllCalled ? 0 : 1 });
        return true;
      }
      if (url.pathname === "/api/notifications/dismiss-all" && route.request().method() === "POST") {
        dismissAllCalled = true;
        await fulfillEmpty(route, 204);
        return true;
      }
      return false;
    });
    await createMockApi(page, state);
    await page.goto("/libraries/lib-personal");
    await page.getByLabel("Notifications").click();
    await expect(page.getByText("Alice created tag vacation")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss all" }).first().click();
    await expect(page.getByText("Alice created tag vacation")).toHaveCount(0);
    await expect(page.getByText("You're all caught up.")).toBeVisible();
  });

  test("library Feed tab is reachable and renders activity", async ({ page }) => {
    const state = createDefaultState();
    addOverride(state, async (route, url) => {
      const m = url.pathname.match(/^\/api\/libraries\/([\w-]+)\/feed$/);
      if (m && route.request().method() === "GET") {
        await fulfillJson(route, 200, {
          entries: [ACT_TAG, ACT_FILE],
          nextCursor: null,
        });
        return true;
      }
      return false;
    });
    await createMockApi(page, state);
    await page.goto("/libraries/lib-personal/feed");

    await expect(page.getByRole("tab", { name: "Feed" })).toBeVisible();
    await expect(page.getByText("Alice created tag vacation")).toBeVisible();
    await expect(page.getByText("Alice added photo.jpg")).toBeVisible();
  });
});
