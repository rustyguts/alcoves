import type { Ref } from "vue";
import type { LibraryFile, LibraryFolder, LibraryTag } from "~~/shared/types/api";
import { isTagColorInPalette, TAG_COLOR_PALETTE } from "~~/shared/tag-colors";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";

type LibraryTagsRef = Ref<LibraryTag[]>;
type FilesRef = Ref<LibraryFile[]>;

export function useLibraryTags(
  libraryId: Ref<string>,
  libraryTags: LibraryTagsRef,
  files: FilesRef,
) {
  const toast = useToast();

  const createTagName = ref("");
  const creatingTag = ref(false);
  const tagDraftNames = reactive<Record<string, string>>({});

  watch(
    libraryTags,
    (nextTags) => {
      const keepIds = new Set(nextTags.map((tag) => tag.id));
      Object.keys(tagDraftNames).forEach((id) => {
        if (!keepIds.has(id)) {
          delete tagDraftNames[id];
        }
      });
      nextTags.forEach((tag) => {
        tagDraftNames[tag.id] = tag.name;
      });
    },
    { immediate: true },
  );

  async function saveFileTags(file: LibraryFile, tagIds: string[]) {
    const result = await api.tags.syncFileTags(libraryId.value, file.id, { tagIds });
    file.tags = result.tags;
  }

  async function saveFolderTags(folder: LibraryFolder, tagIds: string[]) {
    const result = await api.tags.syncFolderTags(libraryId.value, folder.id, { tagIds });
    folder.tags = result.tags;
  }

  function isTagAssigned(file: LibraryFile, tagId: string): boolean {
    return file.tags.some((tag) => tag.id === tagId);
  }

  function isFolderTagAssigned(folder: LibraryFolder, tagId: string): boolean {
    return folder.tags.some((tag) => tag.id === tagId);
  }

  function areAllFilesTagged(fileIds: string[], tagId: string): boolean {
    return fileIds.every((id) => {
      const file = files.value.find((item) => item.id === id);
      return file ? isTagAssigned(file, tagId) : false;
    });
  }

  async function toggleTagForFolder(folder: LibraryFolder, tagId: string) {
    const nextTagIds = new Set(folder.tags.map((tag) => tag.id));
    if (isFolderTagAssigned(folder, tagId)) {
      nextTagIds.delete(tagId);
    } else {
      nextTagIds.add(tagId);
    }

    try {
      await saveFolderTags(folder, [...nextTagIds]);
    } catch {
      toast.add({ title: "Failed to update folder tags", color: "error" });
    }
  }

  async function toggleTagForFiles(fileIds: string[], tagId: string) {
    const targetFiles = files.value.filter((file) => fileIds.includes(file.id));
    if (!targetFiles.length) return;

    const shouldAddTag = !targetFiles.every((file) => isTagAssigned(file, tagId));

    try {
      await Promise.all(
        targetFiles.map((file) => {
          const nextTagIds = new Set(file.tags.map((tag) => tag.id));
          if (shouldAddTag) {
            nextTagIds.add(tagId);
          } else {
            nextTagIds.delete(tagId);
          }
          return saveFileTags(file, [...nextTagIds]);
        }),
      );
    } catch {
      toast.add({ title: "Failed to update file tags", color: "error" });
    }
  }

  async function createTag(color?: string) {
    const name = createTagName.value.trim();
    if (!name) return;
    creatingTag.value = true;
    try {
      const normalizedColor = color?.trim().toUpperCase();
      const tag = await api.tags.create(libraryId.value, normalizedColor ? { name, color: normalizedColor } : { name });
      libraryTags.value = [...libraryTags.value, tag].sort((a, b) => a.name.localeCompare(b.name));
      createTagName.value = "";
    } catch {
      toast.add({ title: "Failed to create tag", color: "error" });
    } finally {
      creatingTag.value = false;
    }
  }

  async function updateTagColor(tag: LibraryTag, color: string) {
    const normalized = color.trim().toUpperCase();
    if (normalized === tag.color.toUpperCase()) return;

    try {
      const updated = await api.tags.update(libraryId.value, tag.id, { color: normalized });
      replaceTag(updated);
    } catch {
      toast.add({ title: "Failed to update tag color", color: "error" });
    }
  }

  function getTagColorChoices(tag: LibraryTag): string[] {
    const normalized = tag.color.trim().toUpperCase();
    if (isTagColorInPalette(normalized)) return [...TAG_COLOR_PALETTE];
    return [normalized, ...TAG_COLOR_PALETTE];
  }

  function isTagColorUsedByAnotherTag(tagId: string, color: string): boolean {
    const normalized = color.toUpperCase();
    return libraryTags.value.some(
      (tag) => tag.id !== tagId && tag.color.toUpperCase() === normalized,
    );
  }

  function selectTagColor(tag: LibraryTag, color: string) {
    updateTagColor(tag, color);
  }

  async function renameTag(tag: LibraryTag, nextName: string) {
    const name = nextName.trim();
    if (!name || name === tag.name) return;
    try {
      const updated = await api.tags.update(libraryId.value, tag.id, { name });
      replaceTag(updated);
    } catch {
      toast.add({ title: "Failed to rename tag", color: "error" });
    }
  }

  async function saveDraftTagName(tag: LibraryTag) {
    await renameTag(tag, tagDraftNames[tag.id] ?? tag.name);
  }

  async function deleteTag(tagId: string) {
    try {
      await api.tags.delete(libraryId.value, tagId);
      libraryTags.value = libraryTags.value.filter((tag) => tag.id !== tagId);
      for (const file of files.value) {
        file.tags = file.tags.filter((tag) => tag.id !== tagId);
      }
    } catch {
      toast.add({ title: "Failed to delete tag", color: "error" });
    }
  }

  function replaceTag(updated: LibraryTag) {
    libraryTags.value = libraryTags.value
      .map((tag) => (tag.id === updated.id ? updated : tag))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const file of files.value) {
      file.tags = file.tags
        .map((tag) => (tag.id === updated.id ? updated : tag))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return {
    createTagName,
    creatingTag,
    tagDraftNames,
    saveFileTags,
    saveFolderTags,
    isTagAssigned,
    isFolderTagAssigned,
    areAllFilesTagged,
    toggleTagForFolder,
    toggleTagForFiles,
    createTag,
    updateTagColor,
    getTagColorChoices,
    isTagColorUsedByAnotherTag,
    selectTagColor,
    renameTag,
    saveDraftTagName,
    deleteTag,
    replaceTag,
  };
}
