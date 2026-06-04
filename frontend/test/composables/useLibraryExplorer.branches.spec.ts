import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed } from "vue";

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

const mocks = vi.hoisted(() => ({
  route: { params: { id: "lib-1" }, query: {} as Record<string, string>, path: "/libraries/lib-1" },
  router: { push: vi.fn(), replace: vi.fn() },
  user: { id: "user-1", email: "u@e.com", displayName: "U", avatarUrl: null, role: "owner" },
  libraryData: null as unknown,
  libraryUsersData: { canManageUsers: true, members: [{ userId: "user-1", role: "owner" }] } as unknown,
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: vi.fn((urlFn: (() => string) | string) => {
    const url = typeof urlFn === "function" ? urlFn() : urlFn;
    if (url.includes("/users")) return { data: ref(mocks.libraryUsersData), refresh: vi.fn() };
    return { data: ref(mocks.libraryData), refresh: vi.fn() };
  }),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({ user: computed(() => mocks.user), loggedIn: { value: true }, fetchSession: vi.fn() }),
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}));
vi.mock("#imports", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useRoute: () => mocks.route, useRouter: () => mocks.router };
});

import { useLibraryExplorer } from "~/composables/useLibraryExplorer";
import { apiFetch } from "~/utils/api-fetch";

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiFetch.mockReset();
  mocks.router.push.mockReset();
  mocks.route.query = {};
  mocks.route.path = "/libraries/lib-1";
  mocks.libraryUsersData = { canManageUsers: true, members: [{ userId: "user-1", role: "owner" }] };
  // creation kicks off fetchInitialData; provide a default page payload
  mockApiFetch.mockImplementation((_url: string, opts?: { query?: Record<string, string> }) => {
    if (opts?.query?.trashed) return Promise.resolve({ entries: [], breadcrumbs: [], nextCursor: null, totalCount: 7 });
    if (typeof _url === "string" && _url.endsWith("/tags")) return Promise.resolve([{ id: "t1", name: "blue" }]);
    if (typeof _url === "string" && _url.endsWith("/folders")) return Promise.resolve([{ id: "fo1", name: "Folder" }]);
    return Promise.resolve({ entries: [], breadcrumbs: [], nextCursor: null, totalCount: 0 });
  });
});

describe("useLibraryExplorer branches", () => {
  it("canManageLibrary is true for an owner member", () => {
    const { canManageLibrary } = useLibraryExplorer();
    expect(canManageLibrary.value).toBe(true);
  });

  it("canManageLibrary is false when the user is only a viewer", () => {
    mocks.libraryUsersData = { canManageUsers: false, members: [{ userId: "user-1", role: "viewer" }] };
    const { canManageLibrary } = useLibraryExplorer();
    expect(canManageLibrary.value).toBe(false);
  });

  it("currentFolderId is null with no folder query", () => {
    const { currentFolderId } = useLibraryExplorer();
    expect(currentFolderId.value).toBeNull();
  });

  it("openFolder builds a navigation for both a folder and the root", () => {
    const { openFolder } = useLibraryExplorer();
    expect(() => {
      openFolder("fo1");
      openFolder(null);
    }).not.toThrow();
  });

  it("refreshTags loads the library tag list", async () => {
    const { refreshTags, libraryTags } = useLibraryExplorer();
    await refreshTags();
    expect(libraryTags.value).toEqual([{ id: "t1", name: "blue" }]);
  });

  it("refreshTrashedCount loads the trashed total", async () => {
    const { refreshTrashedCount, trashedCount } = useLibraryExplorer();
    await refreshTrashedCount();
    expect(trashedCount.value).toBe(7);
  });

  it("refreshFolders returns the folder list", async () => {
    const { refreshFolders } = useLibraryExplorer();
    await expect(refreshFolders()).resolves.toEqual([{ id: "fo1", name: "Folder" }]);
  });
});
