vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

import { useLibraryTags } from "~/composables/useLibraryTags";
import { apiFetch } from "~/utils/api-fetch";
import type { LibraryFile, LibraryFolder, LibraryTag } from "~~/shared/types/api";
import { TAG_COLOR_PALETTE } from "~~/shared/tag-colors";

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

function makeTag(overrides: Partial<LibraryTag> & { id: string; name: string }): LibraryTag {
  return {
    libraryId: "lib-1",
    color: "#E11D48",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFile(overrides: Partial<LibraryFile> & { id: string; name: string }): LibraryFile {
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
    owner: null,
    tags: [],
    ...overrides,
  };
}

describe("useLibraryTags", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mocks.toast.add.mockReset();
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
    const tag = makeTag({ id: "t1", name: "Red", color: "#E06C75" });
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

  it("selectTagColor allows selecting a color used by another tag", () => {
    mockApiFetch.mockResolvedValueOnce(makeTag({ id: "t1", name: "A", color: "#3B82F6" }));
    const t1 = makeTag({ id: "t1", name: "A", color: "#E11D48" });
    const t2 = makeTag({ id: "t2", name: "B", color: "#3B82F6" });
    const { selectTagColor } = createTags([t1, t2]);

    selectTagColor(t1, "#3B82F6");
    expect(mockApiFetch).toHaveBeenCalled();
  });

  it("selectTagColor calls updateTagColor when color is available", () => {
    mockApiFetch.mockResolvedValueOnce(makeTag({ id: "t1", name: "A", color: "#22C55E" }));

    const t1 = makeTag({ id: "t1", name: "A", color: "#E11D48" });
    const { selectTagColor } = createTags([t1]);

    selectTagColor(t1, "#22C55E");
    expect(mockApiFetch).toHaveBeenCalled();
  });

  it("createTag calls apiFetch and adds to libraryTags", async () => {
    const newTag = makeTag({ id: "t-new", name: "New Tag" });
    mockApiFetch.mockResolvedValueOnce(newTag);

    const tagsRef = ref<LibraryTag[]>([]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));
    result.createTagName.value = "New Tag";

    await result.createTag();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags", {
      method: "POST",
      body: { name: "New Tag" },
    });
    expect(tagsRef.value).toContainEqual(newTag);
    expect(result.createTagName.value).toBe("");
  });

  it("createTag sends selected color when provided", async () => {
    const newTag = makeTag({ id: "t-new", name: "New Tag", color: "#22C55E" });
    mockApiFetch.mockResolvedValueOnce(newTag);

    const tagsRef = ref<LibraryTag[]>([]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));
    result.createTagName.value = "New Tag";

    await result.createTag("#22c55e");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags", {
      method: "POST",
      body: { name: "New Tag", color: "#22C55E" },
    });
    expect(tagsRef.value).toContainEqual(newTag);
  });

  it("createTag does nothing with empty name", async () => {
    const { createTag, createTagName } = createTags();
    createTagName.value = "   ";

    await createTag();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("createTag shows toast on error", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("fail"));

    const { createTag, createTagName } = createTags();
    createTagName.value = "Test";

    await createTag();
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Failed to create tag", color: "error" });
  });

  it("renameTag calls apiFetch and replaces tag", async () => {
    const tag = makeTag({ id: "t1", name: "Old" });
    const updated = makeTag({ id: "t1", name: "New" });
    mockApiFetch.mockResolvedValueOnce(updated);

    const tagsRef = ref([tag]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));

    await result.renameTag(tag, "New");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", {
      method: "PATCH",
      body: { name: "New" },
    });
    expect(tagsRef.value[0]!.name).toBe("New");
  });

  it("renameTag does nothing when name is same", async () => {
    const tag = makeTag({ id: "t1", name: "Same" });
    const { renameTag } = createTags([tag]);

    await renameTag(tag, "Same");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("renameTag does nothing with empty name", async () => {
    const tag = makeTag({ id: "t1", name: "Test" });
    const { renameTag } = createTags([tag]);

    await renameTag(tag, "  ");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("deleteTag removes tag from libraryTags and files", async () => {
    mockApiFetch.mockResolvedValueOnce({});

    const tag = makeTag({ id: "t1", name: "Delete Me" });
    const file = makeFile({ id: "f1", name: "doc.txt", tags: [tag] });
    const tagsRef = ref([tag]);
    const filesRef = ref([file]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, filesRef);

    await result.deleteTag("t1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", { method: "DELETE" });
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
    mockApiFetch.mockResolvedValue({ tags: [tag] });

    const { toggleTagForFiles } = createTags([tag], [f1, f2]);
    await toggleTagForFiles(["f1", "f2"], "t1");

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("toggleTagForFiles removes tag when all files have it", async () => {
    const tag = makeTag({ id: "t1", name: "Tag" });
    const f1 = makeFile({ id: "f1", name: "a.txt", tags: [tag] });
    const f2 = makeFile({ id: "f2", name: "b.txt", tags: [tag] });
    mockApiFetch.mockResolvedValue({ tags: [] });

    const { toggleTagForFiles } = createTags([tag], [f1, f2]);
    await toggleTagForFiles(["f1", "f2"], "t1");

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("toggleTagForFiles does nothing for empty file list", async () => {
    const { toggleTagForFiles } = createTags();
    await toggleTagForFiles([], "t1");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("toggleTagForFolder adds tag when not assigned", async () => {
    const tag = makeTag({ id: "t1", name: "Tag" });
    const folder = makeFolder({ id: "fo1", name: "Docs", tags: [] });
    mockApiFetch.mockResolvedValueOnce({ tags: [tag] });

    const { toggleTagForFolder } = createTags([tag]);
    await toggleTagForFolder(folder, "t1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/fo1/tags", {
      method: "PUT",
      body: { tagIds: ["t1"] },
    });
  });

  it("toggleTagForFolder removes tag when assigned", async () => {
    const tag = makeTag({ id: "t1", name: "Tag" });
    const folder = makeFolder({ id: "fo1", name: "Docs", tags: [tag] });
    mockApiFetch.mockResolvedValueOnce({ tags: [] });

    const { toggleTagForFolder } = createTags([tag]);
    await toggleTagForFolder(folder, "t1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/folders/fo1/tags", {
      method: "PUT",
      body: { tagIds: [] },
    });
  });

  it("saveDraftTagName renames using draft value", async () => {
    const tag = makeTag({ id: "t1", name: "Old" });
    const updated = makeTag({ id: "t1", name: "Draft Name" });
    mockApiFetch.mockResolvedValueOnce(updated);

    const tagsRef = ref([tag]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));

    // The watcher sets tagDraftNames from libraryTags
    await nextTick();
    result.tagDraftNames["t1"] = "Draft Name";

    await result.saveDraftTagName(tag);

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", {
      method: "PATCH",
      body: { name: "Draft Name" },
    });
  });

  it("updateTagColor does nothing when color is the same", async () => {
    const tag = makeTag({ id: "t1", name: "Tag", color: "#E11D48" });
    const { updateTagColor } = createTags([tag]);

    await updateTagColor(tag, "#e11d48");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("updateTagColor calls apiFetch when color differs", async () => {
    const tag = makeTag({ id: "t1", name: "Tag", color: "#E11D48" });
    const updated = makeTag({ id: "t1", name: "Tag", color: "#3B82F6" });
    mockApiFetch.mockResolvedValueOnce(updated);

    const tagsRef = ref([tag]);
    const result = useLibraryTags(ref("lib-1"), tagsRef, ref([]));

    await result.updateTagColor(tag, "#3B82F6");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags/t1", {
      method: "PATCH",
      body: { color: "#3B82F6" },
    });
  });
});
