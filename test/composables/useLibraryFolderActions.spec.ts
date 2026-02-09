import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useLibraryFolderActions } from "~/composables/useLibraryFolderActions";
import type { LibraryFolder } from "~~/shared/types/api";

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
  fetch: vi.fn(),
}));

mockNuxtImport("useToast", () => () => mocks.toast);

function makeFolder(overrides: Partial<LibraryFolder> & { id: string; name: string }): LibraryFolder {
  return {
    libraryId: "lib-1",
    parentFolderId: null,
    kind: "folder",
    trashedAt: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    tags: [],
    ...overrides,
  };
}

describe("useLibraryFolderActions", () => {
  let resetAndFetch: ReturnType<typeof vi.fn>;
  let refreshFolders: ReturnType<typeof vi.fn>;
  let refreshTrashedCount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.toast.add.mockReset();
    vi.stubGlobal("$fetch", mocks.fetch);

    resetAndFetch = vi.fn();
    refreshFolders = vi.fn().mockResolvedValue([]);
    refreshTrashedCount = vi.fn();
  });

  function createActions(folderId: string | null = null) {
    return useLibraryFolderActions(
      ref("lib-1"),
      ref(folderId),
      refreshFolders,
      resetAndFetch,
      refreshTrashedCount,
    );
  }

  it("openCreateFolderModal resets state and opens modal", () => {
    const actions = createActions();
    actions.createFolderName.value = "leftover";
    actions.createFolderOpen.value = false;

    actions.openCreateFolderModal();

    expect(actions.createFolderName.value).toBe("");
    expect(actions.createFolderOpen.value).toBe(true);
  });

  it("createFolder calls $fetch and resets state on success", async () => {
    mocks.fetch.mockResolvedValueOnce(makeFolder({ id: "f-new", name: "New Folder" }));

    const actions = createActions("parent-1");
    actions.createFolderOpen.value = true;
    actions.createFolderName.value = "New Folder";

    await actions.createFolder();

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders", {
      method: "POST",
      body: { name: "New Folder", parentFolderId: "parent-1" },
    });
    expect(actions.createFolderOpen.value).toBe(false);
    expect(actions.createFolderName.value).toBe("");
    expect(resetAndFetch).toHaveBeenCalledTimes(1);
  });

  it("createFolder does nothing when name is empty", async () => {
    const actions = createActions();
    actions.createFolderName.value = "   ";

    await actions.createFolder();

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("createFolder shows toast on error", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("fail"));

    const actions = createActions();
    actions.createFolderName.value = "Test";

    await actions.createFolder();

    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Failed to create folder", color: "error" });
    expect(actions.creatingFolder.value).toBe(false);
  });

  it("moveDestinationOptions excludes self and descendants", async () => {
    const root = makeFolder({ id: "root-f", name: "Root" });
    const child = makeFolder({ id: "child-f", name: "Child", parentFolderId: "root-f" });
    const grandchild = makeFolder({ id: "gc-f", name: "Grandchild", parentFolderId: "child-f" });
    const unrelated = makeFolder({ id: "other-f", name: "Other" });

    refreshFolders.mockResolvedValueOnce([root, child, grandchild, unrelated]);

    const actions = createActions();
    await actions.openMoveFolderModal(root);

    const options = actions.moveDestinationOptions.value;
    const optionValues = options.map((o) => o.value);

    expect(optionValues).toContain("__root__");
    expect(optionValues).toContain("other-f");
    expect(optionValues).not.toContain("root-f");
    expect(optionValues).not.toContain("child-f");
    expect(optionValues).not.toContain("gc-f");
  });

  it("moveDestinationOptions builds nested labels", async () => {
    const parent = makeFolder({ id: "p", name: "Parent" });
    const child = makeFolder({ id: "c", name: "Child", parentFolderId: "p" });
    const target = makeFolder({ id: "t", name: "Target" });

    refreshFolders.mockResolvedValueOnce([parent, child, target]);

    const actions = createActions();
    await actions.openMoveFolderModal(target);

    const options = actions.moveDestinationOptions.value;
    const childOption = options.find((o) => o.value === "c");
    expect(childOption?.label).toBe("Parent / Child");
  });

  it("openMoveFolderModal sets state and loads folders", async () => {
    const folders = [makeFolder({ id: "f1", name: "One" })];
    refreshFolders.mockResolvedValueOnce(folders);

    const actions = createActions();
    const folder = makeFolder({ id: "f-move", name: "Moving", parentFolderId: "f1" });

    await actions.openMoveFolderModal(folder);

    expect(actions.movingFolder.value).toStrictEqual(folder);
    expect(actions.moveDestinationValue.value).toBe("f1");
    expect(actions.moveFolderOpen.value).toBe(true);
    expect(actions.moveLoading.value).toBe(false);
  });

  it("openMoveFolderModal shows toast on error", async () => {
    refreshFolders.mockRejectedValueOnce(new Error("fail"));

    const actions = createActions();
    await actions.openMoveFolderModal(makeFolder({ id: "f1", name: "Test" }));

    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Failed to load folders", color: "error" });
  });

  it("moveFolder calls $fetch with null parent for root", async () => {
    mocks.fetch.mockResolvedValueOnce({});

    const actions = createActions();
    actions.movingFolder.value = makeFolder({ id: "f-move", name: "Moving" });
    actions.moveDestinationValue.value = "__root__";

    await actions.moveFolder();

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/f-move/move", {
      method: "POST",
      body: { parentFolderId: null },
    });
    expect(actions.moveFolderOpen.value).toBe(false);
    expect(resetAndFetch).toHaveBeenCalledTimes(1);
  });

  it("moveFolder calls $fetch with folder id as parent", async () => {
    mocks.fetch.mockResolvedValueOnce({});

    const actions = createActions();
    actions.movingFolder.value = makeFolder({ id: "f-move", name: "Moving" });
    actions.moveDestinationValue.value = "dest-folder";

    await actions.moveFolder();

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/f-move/move", {
      method: "POST",
      body: { parentFolderId: "dest-folder" },
    });
  });

  it("moveFolder does nothing without a movingFolder", async () => {
    const actions = createActions();
    await actions.moveFolder();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("moveFolder shows toast on error", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("fail"));

    const actions = createActions();
    actions.movingFolder.value = makeFolder({ id: "f1", name: "Test" });

    await actions.moveFolder();

    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Failed to move folder", color: "error" });
    expect(actions.moveFolderSaving.value).toBe(false);
  });

  it("deleteFolders calls $fetch for each folder then refreshes", async () => {
    mocks.fetch.mockResolvedValue({});

    const actions = createActions();
    await actions.deleteFolders(["f1", "f2"]);

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/f1", { method: "DELETE" });
    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/f2", { method: "DELETE" });
    expect(resetAndFetch).toHaveBeenCalledTimes(1);
    expect(refreshTrashedCount).toHaveBeenCalledTimes(1);
  });

  it("deleteFolder delegates to deleteFolders", async () => {
    mocks.fetch.mockResolvedValue({});

    const actions = createActions();
    await actions.deleteFolder(makeFolder({ id: "f-del", name: "Delete Me" }));

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/f-del", { method: "DELETE" });
  });

  it("deleteFolders shows toast on error", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("fail"));

    const actions = createActions();
    await actions.deleteFolders(["f1"]);

    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Failed to delete folder", color: "error" });
  });
});
