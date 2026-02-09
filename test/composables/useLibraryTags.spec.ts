import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useLibraryTags } from "~/composables/useLibraryTags";
import type { LibraryFile, LibraryFolder, LibraryTag } from "~~/shared/types/api";
import { TAG_COLOR_PALETTE } from "~~/shared/tag-colors";

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
  fetch: vi.fn(),
}));

mockNuxtImport("useToast", () => () => mocks.toast);

function makeTag(overrides: Partial<LibraryTag> & { id: string; name: string }): LibraryTag {
  return {
    libraryId: "lib-1",
    color: "#E11D48",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFile(
  overrides: Partial<LibraryFile> & { id: string; name: string },
): LibraryFile {
  return {
    libraryId: "lib-1",
    parentFolderId: null,
    mimeType: "text/plain",
    size: 100,
    kind: "file",
    originalCreatedAt: null,
    trashedAt: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    owner: null,
    tags: [],
    ...overrides,
  };
}

function makeFolder(
  overrides: Partial<LibraryFolder> & { id: string; name: string },
): LibraryFolder {
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

describe("useLibraryTags", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.toast.add.mockReset();
    vi.stubGlobal("$fetch", mocks.fetch);
  });

  function createTags(tags: LibraryTag[] = [], files: LibraryFile[] = []) {
    return useLibraryTags(ref("lib-1"), ref(tags), ref(files));
  }

  it("isTagAssigned returns true when file has the tag", () => {
    const tag = makeTag({ id: "t1", name: "Important" });
    const file = makeFile({ id: "f1", name: "doc.txt", tags: [tag] });
    const { isTagAssigned } = createTags([tag], [file]);

    expect(isTagAssigned(file, "t1")).toBe(true);
    expect(isTagAssigned(file, "t2")).toBe(false);
  });

  it("isFolderTagAssigned returns true when folder has the tag", () => {
    const tag = makeTag({ id: "t1", name: "Important" });
    const folder = makeFolder({ id: "fo1", name: "Docs", tags: [tag] });
    const { isFolderTagAssigned } = createTags([tag]);

    expect(isFolderTagAssigned(folder, "t1")).toBe(true);
    expect(isFolderTagAssigned(folder, "t2")).toBe(false);
  });

  it("areAllFilesTagged checks all files", () => {
    const tag = makeTag({ id: "t1", name: "Done" });
    const f1 = makeFile({ id: "f1", name: "a.txt", tags: [tag] });
    const f2 = makeFile({ id: "f2", name: "b.txt", tags: [] });
    const { areAllFilesTagged } = createTags([tag], [f1, f2]);

    expect(areAllFilesTagged(["f1"], "t1")).toBe(true);
    expect(areAllFilesTagged(["f1", "f2"], "t1")).toBe(false);
    expect(areAllFilesTagged(["nonexistent"], "t1")).toBe(false);
  });

  it("getTagColorChoices returns palette for palette colors", () => {
    const tag = makeTag({ id: "t1", name: "Red", color: "#E11D48" });
    const { getTagColorChoices } = createTags([tag]);

    const choices = getTagColorChoices(tag);
    expect(choices).toEqual([...TAG_COLOR_PALETTE]);
  });

  it("getTagColorChoices prepends custom color", () => {
    const tag = makeTag({ id: "t1", name: "Custom", color: "#ABCDEF" });
    const { getTagColorChoices } = createTags([tag]);

    const choices = getTagColorChoices(tag);
    expect(choices[0]).toBe("#ABCDEF");
    expect(choices.length).toBe(TAG_COLOR_PALETTE.length + 1);
  });

  it("isTagColorUsedByAnotherTag detects color conflicts", () => {
    const t1 = makeTag({ id: "t1", name: "A", color: "#E11D48" });
    const t2 = makeTag({ id: "t2", name: "B", color: "#3B82F6" });
    const { isTagColorUsedByAnotherTag } = createTags([t1, t2]);

    expect(isTagColorUsedByAnotherTag("t1", "#3B82F6")).toBe(true);
    expect(isTagColorUsedByAnotherTag("t1", "#E11D48")).toBe(false);
    expect(isTagColorUsedByAnotherTag("t1", "#FFFFFF")).toBe(false);
  });

  it("selectTagColor skips when color is used by another tag", () => {
    const t1 = makeTag({ id: "t1", name: "A", color: "#E11D48" });
    const t2 = makeTag({ id: "t2", name: "B", color: "#3B82F6" });
    const { selectTagColor } = createTags([t1, t2]);

    selectTagColor(t1, "#3B82F6");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("selectTagColor calls updateTagColor when color is available", () => {
    mocks.fetch.mockResolvedValueOnce(makeTag({ id: "t1", name: "A", color: "#22C55E" }));

    const t1 = makeTag({ id: "t1", name: "A", color: "#E11D48" });
    const { selectTagColor } = createTags([t1]);

    selectTagColor(t1, "#22C55E");
    expect(mocks.fetch).toHaveBeenCalled();
  });

  it("createTag calls $fetch and adds to libraryTags", async () => {
    const newTag = makeTag({ id: "t-new", name: "New Tag" });
    mocks.fetch.mockResolvedValueOnce(newTag);

    const tagsRef = ref<LibraryTag[]>([]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));
    result.createTagName.value = "New Tag";

    await result.createTag();

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags", {
      method: "POST",
      body: { name: "New Tag" },
    });
    expect(tagsRef.value).toContainEqual(newTag);
    expect(result.createTagName.value).toBe("");
  });

  it("createTag does nothing with empty name", async () => {
    const { createTag, createTagName } = createTags();
    createTagName.value = "   ";

    await createTag();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("createTag shows toast on error", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("fail"));

    const { createTag, createTagName } = createTags();
    createTagName.value = "Test";

    await createTag();
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Failed to create tag", color: "error" });
  });

  it("renameTag calls $fetch and replaces tag", async () => {
    const tag = makeTag({ id: "t1", name: "Old" });
    const updated = makeTag({ id: "t1", name: "New" });
    mocks.fetch.mockResolvedValueOnce(updated);

    const tagsRef = ref([tag]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));

    await result.renameTag(tag, "New");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", {
      method: "PATCH",
      body: { name: "New" },
    });
    expect(tagsRef.value[0]!.name).toBe("New");
  });

  it("renameTag does nothing when name is same", async () => {
    const tag = makeTag({ id: "t1", name: "Same" });
    const { renameTag } = createTags([tag]);

    await renameTag(tag, "Same");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("renameTag does nothing with empty name", async () => {
    const tag = makeTag({ id: "t1", name: "Test" });
    const { renameTag } = createTags([tag]);

    await renameTag(tag, "  ");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("deleteTag removes tag from libraryTags and files", async () => {
    mocks.fetch.mockResolvedValueOnce({});

    const tag = makeTag({ id: "t1", name: "Delete Me" });
    const file = makeFile({ id: "f1", name: "doc.txt", tags: [tag] });
    const tagsRef = ref([tag]);
    const filesRef = ref([file]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, filesRef);

    await result.deleteTag("t1");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", { method: "DELETE" });
    expect(tagsRef.value).toHaveLength(0);
    expect(filesRef.value[0]!.tags).toHaveLength(0);
  });

  it("replaceTag updates libraryTags and file tags", () => {
    const tag = makeTag({ id: "t1", name: "Old", color: "#E11D48" });
    const file = makeFile({ id: "f1", name: "doc.txt", tags: [tag] });
    const tagsRef = ref([tag]);
    const filesRef = ref([file]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, filesRef);

    const updated = makeTag({ id: "t1", name: "New", color: "#3B82F6" });
    result.replaceTag(updated);

    expect(tagsRef.value[0]!.name).toBe("New");
    expect(tagsRef.value[0]!.color).toBe("#3B82F6");
    expect(filesRef.value[0]!.tags[0]!.name).toBe("New");
  });

  it("toggleTagForFiles adds tag when not all files have it", async () => {
    const tag = makeTag({ id: "t1", name: "Tag" });
    const f1 = makeFile({ id: "f1", name: "a.txt", tags: [tag] });
    const f2 = makeFile({ id: "f2", name: "b.txt", tags: [] });
    mocks.fetch.mockResolvedValue({ tags: [tag] });

    const { toggleTagForFiles } = createTags([tag], [f1, f2]);
    await toggleTagForFiles(["f1", "f2"], "t1");

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("toggleTagForFiles removes tag when all files have it", async () => {
    const tag = makeTag({ id: "t1", name: "Tag" });
    const f1 = makeFile({ id: "f1", name: "a.txt", tags: [tag] });
    const f2 = makeFile({ id: "f2", name: "b.txt", tags: [tag] });
    mocks.fetch.mockResolvedValue({ tags: [] });

    const { toggleTagForFiles } = createTags([tag], [f1, f2]);
    await toggleTagForFiles(["f1", "f2"], "t1");

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("toggleTagForFiles does nothing for empty file list", async () => {
    const { toggleTagForFiles } = createTags();
    await toggleTagForFiles([], "t1");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("toggleTagForFolder adds tag when not assigned", async () => {
    const tag = makeTag({ id: "t1", name: "Tag" });
    const folder = makeFolder({ id: "fo1", name: "Docs", tags: [] });
    mocks.fetch.mockResolvedValueOnce({ tags: [tag] });

    const { toggleTagForFolder } = createTags([tag]);
    await toggleTagForFolder(folder, "t1");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/fo1/tags", {
      method: "PUT",
      body: { tagIds: ["t1"] },
    });
  });

  it("toggleTagForFolder removes tag when assigned", async () => {
    const tag = makeTag({ id: "t1", name: "Tag" });
    const folder = makeFolder({ id: "fo1", name: "Docs", tags: [tag] });
    mocks.fetch.mockResolvedValueOnce({ tags: [] });

    const { toggleTagForFolder } = createTags([tag]);
    await toggleTagForFolder(folder, "t1");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/fo1/tags", {
      method: "PUT",
      body: { tagIds: [] },
    });
  });

  it("saveDraftTagName renames using draft value", async () => {
    const tag = makeTag({ id: "t1", name: "Old" });
    const updated = makeTag({ id: "t1", name: "Draft Name" });
    mocks.fetch.mockResolvedValueOnce(updated);

    const tagsRef = ref([tag]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));

    // The watcher sets tagDraftNames from libraryTags
    await nextTick();
    result.tagDraftNames["t1"] = "Draft Name";

    await result.saveDraftTagName(tag);

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", {
      method: "PATCH",
      body: { name: "Draft Name" },
    });
  });

  it("updateTagColor does nothing when color is the same", async () => {
    const tag = makeTag({ id: "t1", name: "Tag", color: "#E11D48" });
    const { updateTagColor } = createTags([tag]);

    await updateTagColor(tag, "#e11d48");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("updateTagColor calls $fetch when color differs", async () => {
    const tag = makeTag({ id: "t1", name: "Tag", color: "#E11D48" });
    const updated = makeTag({ id: "t1", name: "Tag", color: "#3B82F6" });
    mocks.fetch.mockResolvedValueOnce(updated);

    const tagsRef = ref([tag]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));

    await result.updateTagColor(tag, "#3B82F6");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", {
      method: "PATCH",
      body: { color: "#3B82F6" },
    });
  });
});
