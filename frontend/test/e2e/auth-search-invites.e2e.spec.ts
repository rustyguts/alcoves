import { expect, test, type Page, type Route } from "@playwright/test";

type Role = "owner" | "viewer";

type MockState = {
  loggedIn: boolean;
  role: Role;
};

const baseUser = {
  id: "user-1",
  email: "good@example.com",
  displayName: "Good User",
  avatarUrl: null,
};

async function fulfillJson(route: Route, status: number, payload: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function makeSearchResults(query: string) {
  const trimmed = query.trim().toLowerCase();

  if (trimmed.includes("plan")) {
    return {
      query,
      totalCount: 1,
      results: [
        {
          id: "file-1",
          kind: "file",
          name: "Quarterly Plan.txt",
          mimeType: "text/plain",
          size: 1024,
          updatedAt: "2025-01-01T00:00:00.000Z",
          libraryId: "lib-default",
          libraryName: "Personal",
          locationPath: "Root/Planning",
          targetFolderId: "folder-planning",
        },
      ],
    };
  }

  if (trimmed.includes("folder")) {
    return {
      query,
      totalCount: 1,
      results: [
        {
          id: "folder-1",
          kind: "folder",
          name: "Project Folder",
          mimeType: null,
          size: null,
          updatedAt: "2025-01-02T00:00:00.000Z",
          libraryId: "lib-default",
          libraryName: "Personal",
          locationPath: "Root",
          targetFolderId: "folder-1",
        },
      ],
    };
  }

  return {
    query,
    totalCount: 0,
    results: [],
  };
}

async function mockApi(page: Page, state: MockState) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    // Nuxt dev asset URLs can include "/api/" in nested file paths (e.g. @vue/devtools-api).
    // Only intercept actual application API routes.
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (path === "/api/_auth/session") {
      if (state.loggedIn) {
        await fulfillJson(route, 200, {
          user: {
            ...baseUser,
            role: state.role,
          },
        });
        return;
      }

      await fulfillJson(route, 200, {});
      return;
    }

    if (path === "/api/auth/login" && request.method() === "POST") {
      const data = request.postDataJSON() as { email?: string; password?: string };

      if (data.email === "good@example.com" && data.password === "password123") {
        state.loggedIn = true;
        await fulfillJson(route, 200, { ok: true });
      } else {
        await fulfillJson(route, 401, { message: "Invalid email or password" });
      }
      return;
    }

    if (path === "/api/auth/register" && request.method() === "POST") {
      const data = request.postDataJSON() as { email?: string; password?: string };
      if (!data.email || !data.password || data.password.length < 8) {
        await fulfillJson(route, 400, { message: "Registration failed" });
      } else {
        state.loggedIn = true;
        await fulfillJson(route, 200, { ok: true });
      }
      return;
    }

    if (path === "/api/auth/logout" && request.method() === "POST") {
      state.loggedIn = false;
      await fulfillJson(route, 200, { ok: true });
      return;
    }

    if (path === "/api/libraries") {
      if (!state.loggedIn) {
        await fulfillJson(route, 401, { message: "Unauthorized" });
        return;
      }

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

    if (path === "/api/libraries/lib-default/users") {
      await fulfillJson(route, 200, {
        canManageUsers: false,
        members: [],
        pendingInvites: [],
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

    if (path === "/api/admin/users") {
      await fulfillJson(route, 200, [
        {
          id: "user-1",
          email: "good@example.com",
          displayName: "Good User",
          avatarUrl: null,
          role: "owner",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ]);
      return;
    }

    if (path === "/api/search") {
      if (!state.loggedIn) {
        await fulfillJson(route, 401, { message: "Unauthorized" });
        return;
      }
      const query = url.searchParams.get("q") ?? "";
      await fulfillJson(route, 200, makeSearchResults(query));
      return;
    }

    if (path === "/api/invites/test-token") {
      await fulfillJson(route, 200, {
        status: "pending",
        role: "viewer",
        canAccept: true,
        invitedEmail: null,
        library: {
          id: "lib-default",
          name: "Personal",
        },
        invitedBy: {
          displayName: "Owner",
          avatarUrl: null,
        },
      });
      return;
    }

    if (path === "/api/invites/revoked-token") {
      await fulfillJson(route, 200, {
        status: "revoked",
        role: "viewer",
        canAccept: false,
        invitedEmail: null,
        library: {
          id: "lib-default",
          name: "Personal",
        },
        invitedBy: {
          displayName: "Owner",
          avatarUrl: null,
        },
      });
      return;
    }

    if (path === "/api/invites/test-token/accept" && request.method() === "POST") {
      await fulfillJson(route, 200, {
        libraryId: "lib-default",
        libraryName: "Personal",
      });
      return;
    }

    await fulfillJson(route, 404, { message: `Unhandled API route: ${path}` });
  });
}

test.describe("Auth and core app flows", () => {
  test("redirects unauthenticated users from protected routes", async ({ page }) => {
    const state: MockState = { loggedIn: false, role: "owner" };
    await mockApi(page, state);

    await page.goto("/search?q=plan", { waitUntil: "networkidle" });

    await expect(page).toHaveURL(/\/login\?redirect=\/search\?q=plan/);
  });

  test("shows google auth failure message from query", async ({ page }) => {
    const state: MockState = { loggedIn: false, role: "owner" };
    await mockApi(page, state);

    await page.goto("/login?error=google");

    await expect(page.getByText("Google sign-in failed. Please try again.")).toBeVisible();
  });

  test("preserves redirect target in login/register cross links", async ({ page }) => {
    const state: MockState = { loggedIn: false, role: "owner" };
    await mockApi(page, state);

    await page.goto("/login?redirect=/search");
    await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/register?redirect=/search",
    );

    await page.goto("/register?redirect=/search");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?redirect=/search",
    );
  });

  test("shows API error when login fails", async ({ page }) => {
    const state: MockState = { loggedIn: false, role: "owner" };
    await mockApi(page, state);

    await page.goto("/login");
    await page.getByPlaceholder("Enter your email").fill("bad@example.com");
    await page.getByPlaceholder("Enter your password").fill("wrongpass");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });

  test("logs in and redirects to requested search route", async ({ page }) => {
    const state: MockState = { loggedIn: false, role: "owner" };
    await mockApi(page, state);

    await page.goto("/login?redirect=%2Fsearch%3Fq%3Dplan");
    await page.getByPlaceholder("Enter your email").fill("good@example.com");
    await page.getByPlaceholder("Enter your password").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/search\?q=plan/);
    await expect(page.getByText("Quarterly Plan.txt")).toBeVisible();
  });

  test("registers and redirects to requested route", async ({ page }) => {
    const state: MockState = { loggedIn: false, role: "owner" };
    await mockApi(page, state);

    await page.goto("/register?redirect=%2Fsearch%3Fq%3Dfolder");
    await page.getByPlaceholder("Enter your full name").fill("New User");
    await page.getByPlaceholder("Enter your email").fill("new@example.com");
    await page.getByPlaceholder("Create a password").fill("password123");
    await page.getByPlaceholder("Confirm your password").fill("password123");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/search\?q=folder/);
    await expect(page.getByText("Project Folder")).toBeVisible();
  });

  test("shows search minimum-length state before query is entered", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/search");

    await expect(page.getByText("Enter at least 2 characters to start searching.")).toBeVisible();
  });

  test("renders invite pending and revoked states", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/invites/test-token");
    await expect(
      page.getByText("Accept this invitation to get access to the library."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept Invite" })).toBeVisible();

    await page.goto("/invites/revoked-token");
    await expect(page.getByText("This invitation was revoked by a library admin.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept Invite" })).toHaveCount(0);
  });

  test("accepts invite and navigates to target library", async ({ page }) => {
    const state: MockState = { loggedIn: true, role: "owner" };
    await mockApi(page, state);

    await page.goto("/invites/test-token");
    await page.getByRole("button", { name: "Accept Invite" }).click();

    await expect(page).toHaveURL(/\/libraries\/lib-default/);
  });
});
