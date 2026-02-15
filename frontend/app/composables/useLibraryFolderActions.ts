import type { Ref } from "vue";
import type { LibraryFolder } from "~~/shared/types/api";
import { apiFetch } from "~/utils/api-fetch";

type RefreshFoldersFn = () => Promise<LibraryFolder[]>;
type AsyncVoidFn = () => Promise<void>;

const ROOT_MOVE_VALUE = "__root__";

export function useLibraryFolderActions(
  libraryId: Ref<string>,
  currentFolderId: Ref<string | null>,
  refreshFolders: RefreshFoldersFn,
  resetAndFetch: AsyncVoidFn,
  refreshTrashedCount: AsyncVoidFn,
) {
  const toast = useToast();

  const createFolderOpen = ref(false);
  const createFolderName = ref("");
  const creatingFolder = ref(false);

  const moveFolderOpen = ref(false);
  const movingFolder = ref<LibraryFolder | null>(null);
  const moveDestinationValue = ref<string>(ROOT_MOVE_VALUE);
  const moveLoading = ref(false);
  const moveFolderSaving = ref(false);
  const allFolders = ref<LibraryFolder[]>([]);

  function openCreateFolderModal() {
    createFolderName.value = "";
    createFolderOpen.value = true;
  }

  async function createFolder() {
    const name = createFolderName.value.trim();
    if (!name) return;

    creatingFolder.value = true;
    try {
      await apiFetch<LibraryFolder>(`/api/libraries/${libraryId.value}/folders`, {
        method: "POST",
        body: {
          name,
          parentFolderId: currentFolderId.value,
        },
      });
      createFolderOpen.value = false;
      createFolderName.value = "";
      await resetAndFetch();
    } catch {
      toast.add({ title: "Failed to create folder", color: "error" });
    } finally {
      creatingFolder.value = false;
    }
  }

  function collectDescendantIds(rootId: string, folders: LibraryFolder[]): Set<string> {
    const children = new Map<string | null, LibraryFolder[]>();
    for (const folder of folders) {
      const key = folder.parentFolderId;
      const list = children.get(key) ?? [];
      list.push(folder);
      children.set(key, list);
    }

    const descendants = new Set<string>();
    const stack = [rootId];

    while (stack.length) {
      const current = stack.pop()!;
      const directChildren = children.get(current) ?? [];
      for (const child of directChildren) {
        if (descendants.has(child.id)) continue;
        descendants.add(child.id);
        stack.push(child.id);
      }
    }

    return descendants;
  }

  function buildFolderLabel(folder: LibraryFolder, folderMap: Map<string, LibraryFolder>) {
    const parts: string[] = [folder.name];
    let current = folder.parentFolderId;
    let guard = 0;

    while (current && guard < 100) {
      const parent = folderMap.get(current);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent.parentFolderId;
      guard++;
    }

    return parts.join(" / ");
  }

  const moveDestinationOptions = computed(() => {
    const base = [{ label: "Root", value: ROOT_MOVE_VALUE }];
    const targetFolder = movingFolder.value;
    if (!targetFolder) return base;

    const excluded = collectDescendantIds(targetFolder.id, allFolders.value);
    excluded.add(targetFolder.id);

    const folderMap = new Map(allFolders.value.map((folder) => [folder.id, folder]));

    const options = allFolders.value
      .filter((folder) => !excluded.has(folder.id))
      .map((folder) => ({
        label: buildFolderLabel(folder, folderMap),
        value: folder.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [...base, ...options];
  });

  async function openMoveFolderModal(folder: LibraryFolder) {
    movingFolder.value = folder;
    moveDestinationValue.value = folder.parentFolderId ?? ROOT_MOVE_VALUE;
    moveFolderOpen.value = true;

    moveLoading.value = true;
    try {
      allFolders.value = await refreshFolders();
    } catch {
      toast.add({ title: "Failed to load folders", color: "error" });
    } finally {
      moveLoading.value = false;
    }
  }

  async function moveFolder() {
    if (!movingFolder.value) return;

    moveFolderSaving.value = true;
    try {
      const parentFolderId =
        moveDestinationValue.value === ROOT_MOVE_VALUE ? null : moveDestinationValue.value;

      await apiFetch(`/api/libraries/${libraryId.value}/folders/${movingFolder.value.id}/move`, {
        method: "POST",
        body: { parentFolderId },
      });

      moveFolderOpen.value = false;
      await resetAndFetch();
    } catch {
      toast.add({ title: "Failed to move folder", color: "error" });
    } finally {
      moveFolderSaving.value = false;
    }
  }

  async function deleteFolders(folderIds: string[]) {
    try {
      await Promise.all(
        folderIds.map((folderId) =>
          apiFetch(`/api/libraries/${libraryId.value}/folders/${folderId}`, {
            method: "DELETE",
          }),
        ),
      );
      await Promise.all([resetAndFetch(), refreshTrashedCount()]);
    } catch {
      toast.add({ title: "Failed to delete folder", color: "error" });
    }
  }

  async function deleteFolder(folder: LibraryFolder) {
    await deleteFolders([folder.id]);
  }

  return {
    createFolderOpen,
    createFolderName,
    creatingFolder,
    openCreateFolderModal,
    createFolder,
    moveFolderOpen,
    movingFolder,
    moveDestinationValue,
    moveLoading,
    moveFolderSaving,
    moveDestinationOptions,
    openMoveFolderModal,
    moveFolder,
    deleteFolders,
    deleteFolder,
  };
}
