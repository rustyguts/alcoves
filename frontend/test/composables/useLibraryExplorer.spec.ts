vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: vi.fn((urlFn: (() => string) | string) => {
    const url = typeof urlFn === "function" ? urlFn() : urlFn;
    if (url.includes("/users")) {
      return {
        data: ref(mocks.libraryUsersData),
        refresh: vi.fn(),
      };
    }
    return {
      data: ref(mocks.libraryData),
      refresh: vi.fn(),
    };
  }),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: computed(() => mocks.user),
  }),
}));

const mocks = vi.hoisted(() => ({
  route: {
    params: { id: "lib-1" } as Record<string, string>,
    query: {} as Record<string, string>,
    path: "/libraries/lib-1",
  },
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
  user: {
    id: "user-1",
    email: "u@example.com",
    displayName: "User",
    avatarUrl: null,
    role: "owner",
  },
  libraryData: null as { id: string; name: string; ownerId: string; isDefault: boolean } | null,
  libraryUsersData: null as {
    canManageUsers: boolean;
    members: Array<{ userId: string; role: string }>;
  } | null,
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}));

import { useLibraryExplorer } from "~/composables/useLibraryExplorer";
import { apiFetch } from "~/utils/api-fetch";
import type { LibraryFile, LibraryFolder, LibraryEntry, PaginatedFiles } from "~~/shared/types/api";

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

describe("useLibraryExplorer", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mocks.router.push.mockReset();
    mocks.route.params = { id: "lib-1" };
    mocks.route.query = {};
    mocks.route.path = "/libraries/lib-1";
    mocks.user = {
      id: "user-1",
      email: "u@example.com",
      displayName: "User",
      avatarUrl: null,
      role: "owner",
    };
    mocks.libraryData = null;
    mocks.libraryUsersData = null;

    // The composable calls fetchInitialData on creation via watch,
    // so provide a default response for apiFetch
    mockApiFetch.mockResolvedValue({
      entries: [],
      nextCursor: null,
      totalCount: 0,
      breadcrumbs: [],
    });
  });

  it("computes libraryId from route params", () => {
    const { libraryId } = useLibraryExplorer();
    expect(libraryId.value).toBe("lib-1");
  });

  it("viewMode starts as files", () => {
    const { viewMode, showTrashed, showTags, showUsers } = useLibraryExplorer();
    expect(viewMode.value).toBe("files");
    expect(showTrashed.value).toBe(false);
    expect(showTags.value).toBe(false);
    expect(showUsers.value).toBe(false);
  });

  it("showTrashed/showTags/showUsers reflect viewMode", () => {
    const { viewMode, showTrashed, showTags, showUsers } = useLibraryExplorer();

    viewMode.value = "trash";
    expect(showTrashed.value).toBe(true);
    expect(showTags.value).toBe(false);
    expect(showUsers.value).toBe(false);

    viewMode.value = "tags";
    expect(showTags.value).toBe(true);

    viewMode.value = "users";
    expect(showUsers.value).toBe(true);
  });

  it("canManageUsers depends on library users and default flag", () => {
    mocks.libraryUsersData = { canManageUsers: true, members: [] };
    mocks.libraryData = { id: "lib-1", name: "Lib", ownerId: "user-1", isDefault: false };

    const { canManageUsers } = useLibraryExplorer();
    expect(canManageUsers.value).toBe(true);
  });

  it("canManageUsers is false for default library", () => {
    mocks.libraryUsersData = { canManageUsers: true, members: [] };
    mocks.libraryData = { id: "lib-1", name: "Lib", ownerId: "user-1", isDefault: true };

    const { canManageUsers } = useLibraryExplorer();
    expect(canManageUsers.value).toBe(false);
  });

  it("canManageLibrary is true for library owner", () => {
    mocks.libraryData = { id: "lib-1", name: "Lib", ownerId: "user-1", isDefault: false };
    mocks.libraryUsersData = { canManageUsers: false, members: [] };

    const { canManageLibrary } = useLibraryExplorer();
    expect(canManageLibrary.value).toBe(true);
  });

  it("canManageLibrary is true for admin members", () => {
    mocks.libraryData = { id: "lib-1", name: "Lib", ownerId: "other-user", isDefault: false };
    mocks.libraryUsersData = {
      canManageUsers: false,
      members: [{ userId: "user-1", role: "admin" }],
    };

    const { canManageLibrary } = useLibraryExplorer();
    expect(canManageLibrary.value).toBe(true);
  });

  it("canManageLibrary is false for viewers", () => {
    mocks.libraryData = { id: "lib-1", name: "Lib", ownerId: "other-user", isDefault: false };
    mocks.libraryUsersData = {
      canManageUsers: false,
      members: [{ userId: "user-1", role: "viewer" }],
    };

    const { canManageLibrary } = useLibraryExplorer();
    expect(canManageLibrary.value).toBe(false);
  });

  it("currentFolderId extracts from route query", () => {
    mocks.route.query = { folder: "folder-1" };
    const { currentFolderId } = useLibraryExplorer();
    expect(currentFolderId.value).toBe("folder-1");
  });

  it("currentFolderId returns null for non-string query", () => {
    mocks.route.query = {};
    const { currentFolderId } = useLibraryExplorer();
    expect(currentFolderId.value).toBeNull();
  });

  it("currentFolderId returns null for empty string", () => {
    mocks.route.query = { folder: "  " };
    const { currentFolderId } = useLibraryExplorer();
    expect(currentFolderId.value).toBeNull();
  });

  it("buildFolderQuery adds folder to query", () => {
    mocks.route.query = { other: "value" };
    const { buildFolderQuery } = useLibraryExplorer();

    expect(buildFolderQuery("f1")).toEqual({ other: "value", folder: "f1" });
  });

  it("buildFolderQuery removes folder when null", () => {
    mocks.route.query = { folder: "old", other: "value" };
    const { buildFolderQuery } = useLibraryExplorer();

    expect(buildFolderQuery(null)).toEqual({ other: "value" });
  });

  it("openFolder navigates with folder query", () => {
    const { openFolder } = useLibraryExplorer();
    openFolder("f1");

    expect(mocks.router.push).toHaveBeenCalledWith({
      path: "/libraries/lib-1",
      query: { folder: "f1" },
    });
  });

  it("files computed filters entries by kind=file", () => {
    const file: LibraryFile = {
      id: "f1",
      libraryId: "lib-1",
      parentFolderId: null,
      name: "test.txt",
      mimeType: "text/plain",
      size: 100,
      kind: "file",
      originalCreatedAt: null,
      trashedAt: null,
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
      owner: null,
      tags: [],
    };
    const folder: LibraryFolder = {
      id: "fo1",
      libraryId: "lib-1",
      parentFolderId: null,
      name: "docs",
      kind: "folder",
      trashedAt: null,
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
      tags: [],
    };

    const { entries, files, folders } = useLibraryExplorer();
    entries.value = [file, folder];

    expect(files.value).toHaveLength(1);
    expect(files.value[0]!.id).toBe("f1");
    expect(folders.value).toHaveLength(1);
    expect(folders.value[0]!.id).toBe("fo1");
  });

  it("clearSelection clears all selections", () => {
    const {
      selectedFiles,
      selectedFolders,
      lastClickedFileIndex,
      lastClickedFolderIndex,
      clearSelection,
    } = useLibraryExplorer();

    selectedFiles.add("f1");
    selectedFolders.add("fo1");
    lastClickedFileIndex.value = 5;
    lastClickedFolderIndex.value = 3;

    clearSelection();
    expect(selectedFiles.size).toBe(0);
    expect(selectedFolders.size).toBe(0);
    expect(lastClickedFileIndex.value).toBe(5);

    selectedFiles.add("f2");
    clearSelection(true);
    expect(lastClickedFileIndex.value).toBeNull();
    expect(lastClickedFolderIndex.value).toBeNull();
  });

  it("isEntrySelected checks files and folders", () => {
    const { selectedFiles, selectedFolders, isEntrySelected } = useLibraryExplorer();

    selectedFiles.add("f1");
    selectedFolders.add("fo1");

    expect(isEntrySelected({ kind: "file", id: "f1" } as LibraryEntry)).toBe(true);
    expect(isEntrySelected({ kind: "file", id: "f2" } as LibraryEntry)).toBe(false);
    expect(isEntrySelected({ kind: "folder", id: "fo1" } as LibraryEntry)).toBe(true);
    expect(isEntrySelected({ kind: "folder", id: "fo2" } as LibraryEntry)).toBe(false);
  });

  it("fetchPage includes trashed param when in trash view", async () => {
    mockApiFetch.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
      totalCount: 0,
      breadcrumbs: [],
    });

    const { viewMode, fetchPage } = useLibraryExplorer();
    viewMode.value = "trash";

    await fetchPage();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/files", {
      query: { trashed: "true" },
    });
  });

  it("fetchPage includes folder param when in folder", async () => {
    mocks.route.query = { folder: "f1" };
    mockApiFetch.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
      totalCount: 0,
      breadcrumbs: [],
    });

    const { fetchPage } = useLibraryExplorer();
    await fetchPage();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/files", {
      query: { folder: "f1" },
    });
  });

  it("fetchPage includes cursor param", async () => {
    mockApiFetch.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
      totalCount: 0,
      breadcrumbs: [],
    });

    const { fetchPage } = useLibraryExplorer();
    await fetchPage("cursor-abc");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/files", {
      query: { cursor: "cursor-abc" },
    });
  });

  it("loadMore appends entries and updates cursor", async () => {
    const newEntry: LibraryFile = {
      id: "f2",
      libraryId: "lib-1",
      parentFolderId: null,
      name: "new.txt",
      mimeType: "text/plain",
      size: 50,
      kind: "file",
      originalCreatedAt: null,
      trashedAt: null,
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
      owner: null,
      tags: [],
    };

    mockApiFetch.mockResolvedValueOnce({
      entries: [newEntry],
      nextCursor: "cursor-2",
      totalCount: 5,
      breadcrumbs: [{ id: "b1", name: "Root" }],
    });

    const { entries, nextCursor, loadMore, totalCount, breadcrumbs } = useLibraryExplorer();
    nextCursor.value = "cursor-1";

    await loadMore();

    expect(entries.value).toHaveLength(1);
    expect(nextCursor.value).toBe("cursor-2");
    expect(totalCount.value).toBe(5);
    expect(breadcrumbs.value).toEqual([{ id: "b1", name: "Root" }]);
  });

  it("loadMore does nothing when no cursor", async () => {
    const { loadMore, nextCursor } = useLibraryExplorer();
    nextCursor.value = null;
    mockApiFetch.mockReset();

    await loadMore();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("loadMore does nothing when already loading", async () => {
    const { loadMore, nextCursor, loadingMore } = useLibraryExplorer();
    nextCursor.value = "cursor-1";
    loadingMore.value = true;
    mockApiFetch.mockReset();

    await loadMore();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("resetAndFetch clears entries and reloads", async () => {
    mockApiFetch.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
      totalCount: 0,
      breadcrumbs: [],
    });

    const { entries, resetAndFetch, filesPending, selectedFiles } = useLibraryExplorer();
    entries.value = [{ id: "old", kind: "file" } as LibraryEntry];
    selectedFiles.add("old");

    await resetAndFetch();

    expect(entries.value).toEqual([]);
    expect(selectedFiles.size).toBe(0);
    expect(filesPending.value).toBe(false);
  });

  it("resetAndFetch updates trashedCount when in trash view", async () => {
    mockApiFetch.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
      totalCount: 3,
      breadcrumbs: [],
    });

    const { viewMode, resetAndFetch, trashedCount } = useLibraryExplorer();
    viewMode.value = "trash";

    await resetAndFetch();

    expect(trashedCount.value).toBe(3);
  });

  it("refreshTags fetches tags", async () => {
    const tags = [
      { id: "t1", name: "Tag", libraryId: "lib-1", color: "#E11D48", createdAt: "", updatedAt: "" },
    ];
    mockApiFetch.mockResolvedValueOnce(tags);

    const { refreshTags, libraryTags } = useLibraryExplorer();
    await refreshTags();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags");
    expect(libraryTags.value).toEqual(tags);
  });

  it("refreshTrashedCount fetches trashed count", async () => {
    mockApiFetch.mockResolvedValueOnce({ totalCount: 7 });

    const { refreshTrashedCount, trashedCount } = useLibraryExplorer();
    await refreshTrashedCount();

    expect(trashedCount.value).toBe(7);
  });

  it("refreshFolders fetches folders", async () => {
    const folders = [{ id: "fo1", name: "Docs" }];
    mockApiFetch.mockResolvedValueOnce(folders);

    const { refreshFolders } = useLibraryExplorer();
    const result = await refreshFolders();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders");
    expect(result).toEqual(folders);
  });
});
