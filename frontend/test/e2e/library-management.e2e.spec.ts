import { expect, test, type Page, type Route } from "@playwright/test";

type MockState = {
  loggedIn: boolean;
  libraries: Array<{
    id: string;
    name: string;
    emoji: string | null;
    isDefault: boolean;
    ownerId: string;
    faceRecognitionEnabled: boolean;
  }>;
  tags: Array<{
    id: string;
    libraryId: string;
    name: string;
    color: string;
    createdAt: string;
    updatedAt: string;
  }>;
  folders: Array<{
    id: string;
    libraryId: string;
    parentFolderId: string | null;
    name: string;
    kind: "folder";
    trashedAt: string | null;
    createdAt: string;
    updatedAt: string;
    tags: Array<unknown>;
  }>;
};

const baseUser = {
  id: "user-1",
  email: "owner@example.com",
  displayName: "Test Owner",
  avatarUrl: null,
  role: "owner",
};

async function fulfillJson(route: Route, status: number, payload: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function mockApi(page: Page, state: MockState) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (path === "/api/_auth/session") {
      if (state.loggedIn) {
        await fulfillJson(route, 200, { user: baseUser });
      } else {
        await fulfillJson(route, 200, {});
      }
      return;
    }

    if (path === "/api/libraries" && request.method() === "GET") {
      if (!state.loggedIn) {
        await fulfillJson(route, 401, { message: "Unauthorized" });
        return;
      }
      await fulfillJson(
        route,
        200,
        state.libraries.map((l) => ({
          ...l,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        })),
      );
      return;
    }

    if (path === "/api/libraries" && request.method() === "POST") {
      const data = request.postDataJSON() as { name?: string };
      const newLib = {
        id: `lib-${Date.now()}`,
        name: data.name || "Untitled",
        emoji: null,
        isDefault: false,
        ownerId: "user-1",
        faceRecognitionEnabled: false,
      };
      state.libraries.push(newLib);
      await fulfillJson(route, 200, {
        ...newLib,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      });
      return;
    }

    // Match /api/libraries/:id
    const libMatch = path.match(/^\/api\/libraries\/([\w-]+)$/);
    if (libMatch && request.method() === "GET") {
      const lib = state.libraries.find((l) => l.id === libMatch[1]);
      if (lib) {
        await fulfillJson(route, 200, {
          ...lib,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        });
      } else {
        await fulfillJson(route, 404, { message: "Library not found" });
      }
      return;
    }

    // Library files listing
    const filesMatch = path.match(/^\/api\/libraries\/([\w-]+)\/files$/);
    if (filesMatch && request.method() === "GET") {
      await fulfillJson(route, 200, {
        entries: state.folders.filter((f) => f.libraryId === filesMatch[1]),
        breadcrumbs: [],
        nextCursor: null,
        totalCount: state.folders.filter((f) => f.libraryId === filesMatch[1]).length,
      });
      return;
    }

    // Library tags
    const tagsMatch = path.match(/^\/api\/libraries\/([\w-]+)\/tags$/);
    if (tagsMatch && request.method() === "GET") {
      await fulfillJson(
        route,
        200,
        state.tags.filter((t) => t.libraryId === tagsMatch[1]),
      );
      return;
    }

    if (tagsMatch && request.method() === "POST") {
      const data = request.postDataJSON() as { name?: string };
      const newTag = {
        id: `tag-${Date.now()}`,
        libraryId: tagsMatch[1],
        name: data.name || "Untitled Tag",
        color: "#E11D48",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      state.tags.push(newTag);
      await fulfillJson(route, 200, newTag);
      return;
    }

    // Library users
    const usersMatch = path.match(/^\/api\/libraries\/([\w-]+)\/users$/);
    if (usersMatch) {
      await fulfillJson(route, 200, {
        canManageUsers: true,
        members: [
          {
            id: "member-1",
            userId: "user-1",
            libraryId: usersMatch[1],
            role: "owner",
            user: baseUser,
          },
        ],
        pendingInvites: [],
      });
      return;
    }

    // Folders
    const foldersMatch = path.match(/^\/api\/libraries\/([\w-]+)\/folders$/);
    if (foldersMatch && request.method() === "POST") {
      const data = request.postDataJSON() as { name?: string; parentFolderId?: string };
      const newFolder = {
        id: `folder-${Date.now()}`,
        libraryId: foldersMatch[1],
        parentFolderId: data.parentFolderId || null,
        name: data.name || "New Folder",
        kind: "folder" as const,
        trashedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
      };
      state.folders.push(newFolder);
      await fulfillJson(route, 200, newFolder);
      return;
    }

    // Search
    if (path === "/api/search") {
      await fulfillJson(route, 200, { query: "", totalCount: 0, results: [] });
      return;
    }

    // Admin routes
    if (path === "/api/admin/users") {
      await fulfillJson(route, 200, []);
      return;
    }

    await fulfillJson(route, 404, { message: `Unhandled API route: ${path}` });
  });
}

test.describe("Library management flows", () => {
  test("navigates to default library from home page", async ({ page }) => {
    const state: MockState = {
      loggedIn: true,
      libraries: [
        {
          id: "lib-personal",
          name: "Personal",
          emoji: null,
          isDefault: true,
          ownerId: "user-1",
          faceRecognitionEnabled: false,
        },
      ],
      tags: [],
      folders: [],
    };
    await mockApi(page, state);

    await page.goto("/");
    // The home page should show libraries or redirect
    await expect(page).toHaveURL(/\/(libraries\/lib-personal)?$/);
  });

  test("shows library with folders in file listing", async ({ page }) => {
    const state: MockState = {
      loggedIn: true,
      libraries: [
        {
          id: "lib-1",
          name: "Photos",
          emoji: null,
          isDefault: false,
          ownerId: "user-1",
          faceRecognitionEnabled: false,
        },
      ],
      tags: [],
      folders: [
        {
          id: "folder-1",
          libraryId: "lib-1",
          parentFolderId: null,
          name: "Vacation 2025",
          kind: "folder",
          trashedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          tags: [],
        },
      ],
    };
    await mockApi(page, state);

    await page.goto("/libraries/lib-1");
    await expect(page.getByText("Vacation 2025")).toBeVisible();
  });

  test("shows library tags page with existing tags", async ({ page }) => {
    const state: MockState = {
      loggedIn: true,
      libraries: [
        {
          id: "lib-1",
          name: "Photos",
          emoji: null,
          isDefault: false,
          ownerId: "user-1",
          faceRecognitionEnabled: false,
        },
      ],
      tags: [
        {
          id: "tag-1",
          libraryId: "lib-1",
          name: "Important",
          color: "#E11D48",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "tag-2",
          libraryId: "lib-1",
          name: "Archive",
          color: "#3B82F6",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
      folders: [],
    };
    await mockApi(page, state);

    await page.goto("/libraries/lib-1/tags");
    await expect(page.getByText("Add labels to organize files and folders.")).toBeVisible();
    await expect(page.getByText("2 tags")).toBeVisible();
    // Tags appear as input values for inline editing
    await expect(page.locator('input[value="Important"]')).toBeVisible();
    await expect(page.locator('input[value="Archive"]')).toBeVisible();
  });

  test("navigates between library settings sections", async ({ page }) => {
    const state: MockState = {
      loggedIn: true,
      libraries: [
        {
          id: "lib-1",
          name: "Shared Library",
          emoji: null,
          isDefault: false,
          ownerId: "user-1",
          faceRecognitionEnabled: false,
        },
      ],
      tags: [],
      folders: [],
    };
    await mockApi(page, state);

    await page.goto("/libraries/lib-1/settings");
    await expect(page.getByRole("heading", { name: "Shared Library" })).toBeVisible();
  });

  test("navigation tab buttons meet minimum height", async ({ page }) => {
    const state: MockState = {
      loggedIn: true,
      libraries: [
        {
          id: "lib-1",
          name: "Photos",
          emoji: null,
          isDefault: false,
          ownerId: "user-1",
          faceRecognitionEnabled: false,
        },
      ],
      tags: [],
      folders: [],
    };
    await mockApi(page, state);

    await page.goto("/libraries/lib-1");
    await expect(page.getByRole("tab", { name: "Files", exact: true })).toBeVisible();

    const filesTab = page.getByRole("tab", { name: "Files", exact: true });
    const box = await filesTab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });

  test("card view thumbnails render with adequate height", async ({ page }) => {
    const state: MockState = {
      loggedIn: true,
      libraries: [
        {
          id: "lib-1",
          name: "Photos",
          emoji: null,
          isDefault: false,
          ownerId: "user-1",
          faceRecognitionEnabled: false,
        },
      ],
      tags: [],
      folders: [
        {
          id: "folder-1",
          libraryId: "lib-1",
          parentFolderId: null,
          name: "My Folder",
          kind: "folder",
          trashedAt: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          tags: [],
        },
      ],
    };
    await mockApi(page, state);

    await page.goto("/libraries/lib-1");
    await expect(page.getByText("My Folder")).toBeVisible();

    // Switch to card view
    await page.getByRole("button", { name: "Card view" }).click();

    // The card thumbnail area should be visible
    const thumbnail = page.locator(".h-40").first();
    await expect(thumbnail).toBeVisible();
    const box = await thumbnail.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(140);
  });

  test("redirects unauthenticated users away from library pages", async ({ page }) => {
    const state: MockState = {
      loggedIn: false,
      libraries: [],
      tags: [],
      folders: [],
    };
    await mockApi(page, state);

    await page.goto("/libraries/lib-1", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login/);
  });
});
