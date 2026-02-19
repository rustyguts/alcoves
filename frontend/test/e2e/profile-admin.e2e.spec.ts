import { expect, test, type Page, type Route } from "@playwright/test";

type MockState = {
  loggedIn: boolean;
  role: "owner" | "member";
};

const baseUser = {
  id: "user-1",
  email: "admin@example.com",
  displayName: "Admin User",
  avatarUrl: null,
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
        await fulfillJson(route, 200, { user: { ...baseUser, role: state.role } });
      } else {
        await fulfillJson(route, 200, {});
      }
      return;
    }

    if (path === "/api/libraries") {
      await fulfillJson(route, 200, [
        {
          id: "lib-default",
          name: "Personal",
          isDefault: true,
          ownerId: "user-1",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ]);
      return;
    }

    if (path === "/api/libraries/lib-default") {
      await fulfillJson(route, 200, {
        id: "lib-default",
        name: "Personal",
        isDefault: true,
        ownerId: "user-1",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      });
      return;
    }

    if (path === "/api/libraries/lib-default/files") {
      await fulfillJson(route, 200, {
        entries: [],
        breadcrumbs: [],
        nextCursor: null,
        totalCount: 0,
      });
      return;
    }

    if (path === "/api/libraries/lib-default/tags") {
      await fulfillJson(route, 200, []);
      return;
    }

    if (path === "/api/auth/me" && request.method() === "GET") {
      await fulfillJson(route, 200, { ...baseUser, role: state.role });
      return;
    }

    if (path === "/api/auth/me" && request.method() === "PATCH") {
      const body = request.postDataJSON();
      await fulfillJson(route, 200, { ...baseUser, ...body });
      return;
    }

    if (path === "/api/auth/sessions") {
      await fulfillJson(route, 200, [
        {
          id: "session-1",
          userAgent: "Mozilla/5.0 Chrome/120",
          ipAddress: "192.168.1.1",
          createdAt: "2025-06-01T00:00:00Z",
          expiresAt: "2025-07-01T00:00:00Z",
          isCurrent: true,
        },
        {
          id: "session-2",
          userAgent: "Mozilla/5.0 Firefox/120",
          ipAddress: "10.0.0.1",
          createdAt: "2025-06-02T00:00:00Z",
          expiresAt: "2025-07-02T00:00:00Z",
          isCurrent: false,
        },
      ]);
      return;
    }

    if (path === "/api/admin/stats") {
      await fulfillJson(route, 200, {
        users: 5,
        libraries: 3,
        files: 42,
        folders: 12,
        totalSize: 1073741824,
      });
      return;
    }

    if (path === "/api/admin/users") {
      await fulfillJson(route, 200, [
        {
          id: "user-1",
          email: "admin@example.com",
          displayName: "Admin User",
          avatarUrl: null,
          role: "owner",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "user-2",
          email: "user@example.com",
          displayName: "Regular User",
          avatarUrl: null,
          role: "member",
          createdAt: "2025-02-01T00:00:00.000Z",
          updatedAt: "2025-02-01T00:00:00.000Z",
        },
      ]);
      return;
    }

    if (path === "/api/libraries/lib-default/users") {
      await fulfillJson(route, 200, {
        canManageUsers: false,
        members: [],
        pendingInvites: [],
      });
      return;
    }

    if (path === "/api/search") {
      await fulfillJson(route, 200, { query: "", totalCount: 0, results: [] });
      return;
    }

    await fulfillJson(route, 404, { message: `Unhandled: ${path}` });
  });
}

test.describe("Profile page", () => {
  test("shows profile form with user data", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/profile");
    await expect(page.getByText("admin@example.com")).toBeVisible();
    await page.getByRole("button", { name: "Admin User" }).click();
    await expect(page.locator("input[placeholder='Your display name']")).toHaveValue("Admin User");
  });

  test("shows active sessions", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Active Sessions" })).toBeVisible();
    // Should show at least one session
    await expect(page.getByText(/Chrome/)).toBeVisible();
  });
});

test.describe("Admin page", () => {
  test("shows admin dashboard with stats", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
    await expect(page.getByText("Files")).toBeVisible();
    await expect(page.getByText("42")).toBeVisible();
    await expect(page.getByText("Storage")).toBeVisible();
  });

  test("shows user management table", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(page.getByText("Admin User")).toBeVisible();
    await expect(page.getByText("Regular User")).toBeVisible();
    await expect(page.locator(".badge").filter({ hasText: "2" }).first()).toBeVisible();
  });

  test("shows role controls in the users table", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/admin");
    const roleSelects = page.locator("select.select-xs");
    await expect(roleSelects).toHaveCount(2);
    await expect(roleSelects.nth(0)).toHaveValue("owner");
    await expect(roleSelects.nth(1)).toHaveValue("member");
  });
});
