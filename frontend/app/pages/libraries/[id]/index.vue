<script setup lang="ts">
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";
import { getMimeIcon, formatFileSize, formatDate } from "~/utils/mime-icons";
import { apiFetch } from "~/utils/api-fetch";
import { useLibraryExplorer } from "~/composables/useLibraryExplorer";
import { useLibraryTags } from "~/composables/useLibraryTags";
import { useDownloadZip } from "~/composables/useDownloadZip";
import { useLibraryFolderActions } from "~/composables/useLibraryFolderActions";
import { useUploadQueue } from "~/composables/useUploadQueue";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";
import LibraryHeader from "~/components/LibraryHeader.vue";
import UploadModal from "~/components/UploadModal.vue";
import FilePreview from "~/components/FilePreview.vue";
import ClipModal from "~/components/ClipModal.vue";
import AlcovesImage from "~/components/AlcovesImage.vue";

const ENTRY_VIEW_STORAGE_KEY = "alcoves.library.entry-view";
const ROOT_MOVE_VALUE = "__root__";

const toast = useToast();

const {
  route,
  libraryId,
  user,
  library,
  refreshLibrary,
  viewMode,
  entryViewMode,
  showTrashed,
  canManageLibrary,
  currentFolderId,
  buildFolderQuery,
  openFolder,
  entries,
  breadcrumbs,
  nextCursor,
  totalCount,
  trashedCount,
  libraryTags,
  loadingMore,
  filesPending,
  files,
  folders,
  selectedFiles,
  selectedFolders,
  lastClickedFileIndex,
  lastClickedFolderIndex,
  clearSelection,
  isEntrySelected,
  fetchPage,
  loadMore,
  resetAndFetch,
  refreshTags,
  refreshTrashedCount,
  refreshFolders,
} = useLibraryExplorer();

const { isFolderTagAssigned, areAllFilesTagged, toggleTagForFolder, toggleTagForFiles } =
  useLibraryTags(libraryId, libraryTags, files);

const {
  downloading: zipDownloading,
  showSizeWarning,
  estimatedFileCount,
  formattedEstimatedSize,
  startDownload: startZipDownload,
  confirmLargeDownload,
  cancelLargeDownload,
} = useDownloadZip(libraryId);

const renamingEntry = ref<LibraryEntry | null>(null);
const renameValue = ref("");
const uploadOpen = ref(false);
const newDropdown = ref<HTMLDetailsElement | null>(null);
const clipModalOpen = ref(false);
const clipSourceFile = ref<LibraryFile | null>(null);

const {
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
} = useLibraryFolderActions(
  libraryId,
  currentFolderId,
  refreshFolders,
  resetAndFetch,
  refreshTrashedCount,
);

// File preview state
const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);
const draggedFileIds = ref<string[]>([]);
const dropTargetFolderId = ref<string | null>(null);
const moveFilesOpen = ref(false);
const moveFilesLoading = ref(false);
const moveFilesSaving = ref(false);
const moveFileIds = ref<string[]>([]);
const moveFilesDestinationValue = ref<string>(ROOT_MOVE_VALUE);
const moveFileFolders = ref<LibraryFolder[]>([]);
const dragEnabled = computed(() => canManageLibrary.value && !showTrashed.value);
const failedThumbnails = reactive(new Set<string>());

const breadcrumbItems = computed<Array<{ label: string; icon?: string; to: object }>>(() => {
  if (showTrashed.value) return [];

  return [
    {
      label: library.value?.name ?? "Library",
      icon: "i-lucide-house",
      to: {
        path: route.path,
        query: buildFolderQuery(null),
      },
    },
    ...breadcrumbs.value.map((crumb) => ({
      label: crumb.name,
      to: {
        path: route.path,
        query: buildFolderQuery(crumb.id),
      },
    })),
  ];
});

const newMenuItems = computed<Array<Array<{ label: string; icon: string; onSelect: () => void }>>>(() => [
  [
    {
      label: "New folder",
      icon: "i-lucide-folder-plus",
      onSelect: openCreateFolderModal,
    },
  ],
]);

function openPreview(file: LibraryFile) {
  previewFile.value = file;
  previewOpen.value = true;
}

function handleFileUpdate(updated: LibraryFile) {
  const idx = entries.value.findIndex((e) => e.kind === "file" && e.id === updated.id);
  if (idx !== -1) {
    entries.value[idx] = { ...entries.value[idx]!, ...updated };
  }
  if (previewFile.value?.id === updated.id) {
    previewFile.value = { ...previewFile.value, ...updated };
  }
}

function isRenaming(entry: LibraryEntry): boolean {
  return renamingEntry.value?.id === entry.id && renamingEntry.value?.kind === entry.kind;
}

async function startEntryRename(entry: LibraryEntry) {
  if (!canManageLibrary.value) return;
  if (showTrashed.value) return;
  renamingEntry.value = entry;
  renameValue.value = entry.name;
  await nextTick();

  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(
      `[data-rename-input-entry-id="${entry.id}"] input`,
    );
    input?.focus();

    if (entry.kind === "file") {
      const lastDot = entry.name.lastIndexOf(".");
      const selectTo = lastDot > 0 ? lastDot : entry.name.length;
      input?.setSelectionRange(0, selectTo);
    } else {
      input?.setSelectionRange(0, entry.name.length);
    }
  });
}

async function saveEntryRename(entry: LibraryEntry) {
  if (!canManageLibrary.value) {
    renamingEntry.value = null;
    return;
  }
  const rawName = renameValue.value.trim();
  if (!rawName) {
    renamingEntry.value = null;
    return;
  }

  if (entry.kind === "folder") {
    if (entry.name === rawName) {
      renamingEntry.value = null;
      return;
    }

    try {
      const updated = await apiFetch<LibraryFolder>(
        `/api/libraries/${libraryId.value}/folders/${entry.id}`,
        {
          method: "PATCH",
          body: { name: rawName },
        },
      );
      entry.name = updated.name;
      entry.updatedAt = updated.updatedAt;
      breadcrumbs.value = breadcrumbs.value.map((crumb) =>
        crumb.id === updated.id ? { ...crumb, name: updated.name } : crumb,
      );
    } catch {
      toast.add({ title: "Failed to rename folder", color: "error" });
    } finally {
      renamingEntry.value = null;
    }
    return;
  }

  const originalLastDot = entry.name.lastIndexOf(".");
  const originalExt = originalLastDot > 0 ? entry.name.slice(originalLastDot) : "";
  const hasExt = rawName.lastIndexOf(".") > 0;
  const nextName = !hasExt && originalExt ? `${rawName}${originalExt}` : rawName;

  if (entry.name === nextName) {
    renamingEntry.value = null;
    return;
  }

  try {
    await apiFetch(`/api/libraries/${libraryId.value}/files/${entry.id}`, {
      method: "PATCH",
      body: { name: nextName },
    });
    entry.name = nextName;
  } catch {
    toast.add({ title: "Failed to rename file", color: "error" });
  } finally {
    renamingEntry.value = null;
  }
}

function openEntry(entry: LibraryEntry) {
  if (entry.kind === "folder") {
    openFolder(entry.id);
    return;
  }

  openPreview(entry);
}

function isImageFile(file: LibraryFile): boolean {
  return file.mimeType.startsWith("image/");
}

function isSmallImage(file: LibraryFile): boolean {
  return Boolean(file.width && file.height && file.width < 320 && file.height < 160);
}

function cardThumbWidth(file: LibraryFile): number {
  if (file.width && file.width < 720) return file.width;
  return 720;
}

function cardThumbHeight(file: LibraryFile): number {
  if (file.height && file.height < 360) return file.height;
  return 360;
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

const moveFileDestinationOptions = computed(() => {
  const base = [{ label: "Root", value: ROOT_MOVE_VALUE }];
  const folderMap = new Map(moveFileFolders.value.map((folder) => [folder.id, folder]));
  const options = moveFileFolders.value
    .map((folder) => ({
      label: buildFolderLabel(folder, folderMap),
      value: folder.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...base, ...options];
});

const moveFileCount = computed(() => moveFileIds.value.length);

async function moveFilesToFolder(fileIds: string[], targetFolderId: string | null) {
  await Promise.all(
    fileIds.map((fileId) =>
      apiFetch(`/api/libraries/${libraryId.value}/files/${fileId}`, {
        method: "PATCH",
        body: { parentFolderId: targetFolderId },
      }),
    ),
  );
}

async function openMoveFilesModal(fileIds: string[]) {
  if (!dragEnabled.value) return;

  const ids = Array.from(new Set(fileIds));
  if (!ids.length) return;

  moveFileIds.value = ids;
  const targetFiles = files.value.filter((file) => ids.includes(file.id));
  if (!targetFiles.length) return;

  const parentSet = new Set(targetFiles.map((file) => file.parentFolderId));
  const firstParentId = targetFiles[0]?.parentFolderId ?? null;
  moveFilesDestinationValue.value =
    parentSet.size === 1 && firstParentId ? firstParentId : ROOT_MOVE_VALUE;
  moveFilesOpen.value = true;

  moveFilesLoading.value = true;
  try {
    moveFileFolders.value = await refreshFolders();
  } catch {
    toast.add({ title: "Failed to load folders", color: "error" });
  } finally {
    moveFilesLoading.value = false;
  }
}

async function moveFiles() {
  if (!moveFileIds.value.length) return;

  moveFilesSaving.value = true;
  try {
    const parentFolderId =
      moveFilesDestinationValue.value === ROOT_MOVE_VALUE ? null : moveFilesDestinationValue.value;
    const fileIds = moveFileIds.value.filter((fileId) => {
      const file = files.value.find((current) => current.id === fileId);
      if (!file) return false;
      return file.parentFolderId !== parentFolderId;
    });

    if (fileIds.length) {
      await moveFilesToFolder(fileIds, parentFolderId);
      await resetAndFetch();
      clearSelection();
      toast.add({
        title: fileIds.length === 1 ? "File moved" : `${fileIds.length} files moved`,
        color: "success",
      });
    }

    moveFilesOpen.value = false;
    moveFileIds.value = [];
    moveFilesDestinationValue.value = ROOT_MOVE_VALUE;
  } catch {
    toast.add({ title: "Failed to move file(s)", color: "error" });
  } finally {
    moveFilesSaving.value = false;
  }
}

function closeMoveFilesModal() {
  moveFilesOpen.value = false;
  moveFileIds.value = [];
  moveFilesDestinationValue.value = ROOT_MOVE_VALUE;
}

function handleFileDragStart(entry: LibraryEntry, event: DragEvent) {
  if (!dragEnabled.value || entry.kind !== "file" || isRenaming(entry)) return;

  const ids =
    selectedFiles.has(entry.id) && selectedFiles.size > 0 ? [...selectedFiles] : [entry.id];
  draggedFileIds.value = ids;
  event.dataTransfer?.setData("text/plain", ids.join(","));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
}

function handleFileDragEnd() {
  draggedFileIds.value = [];
  dropTargetFolderId.value = null;
}

function handleFolderDragEnter(entry: LibraryEntry) {
  if (!dragEnabled.value || entry.kind !== "folder" || draggedFileIds.value.length === 0) return;
  dropTargetFolderId.value = entry.id;
}

function handleFolderDragOver(entry: LibraryEntry, event: DragEvent) {
  if (!dragEnabled.value || entry.kind !== "folder" || draggedFileIds.value.length === 0) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  dropTargetFolderId.value = entry.id;
}

function handleFolderDragLeave(entry: LibraryEntry, event: DragEvent) {
  if (entry.kind !== "folder" || dropTargetFolderId.value !== entry.id) return;
  const currentTarget = event.currentTarget as Node | null;
  const relatedTarget = event.relatedTarget as Node | null;
  if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) return;
  dropTargetFolderId.value = null;
}

async function handleFolderDrop(entry: LibraryEntry, event: DragEvent) {
  event.preventDefault();
  if (!dragEnabled.value || entry.kind !== "folder") return;

  const targetFolderId = entry.id;
  const fileIds = Array.from(new Set(draggedFileIds.value)).filter((fileId) => {
    const file = files.value.find((current) => current.id === fileId);
    if (!file) return false;
    return file.parentFolderId !== targetFolderId;
  });

  if (!fileIds.length) {
    dropTargetFolderId.value = null;
    return;
  }

  try {
    await moveFilesToFolder(fileIds, targetFolderId);
    clearSelection();
    await resetAndFetch();
    toast.add({
      title: fileIds.length === 1 ? "File moved" : `${fileIds.length} files moved`,
      color: "success",
    });
  } catch {
    toast.add({ title: "Failed to move file(s)", color: "error" });
  } finally {
    draggedFileIds.value = [];
    dropTargetFolderId.value = null;
  }
}

// Library delete state

// Trash permanent delete state
const purgeModalOpen = ref(false);
const purgeConfirmation = ref("");
const filesToPurge = ref<string[]>([]);
const foldersToPurge = ref<string[]>([]);
const purgeAll = ref(false);

// Upload queue integration
const { onLibraryUploadComplete, removeOnComplete } = useUploadQueue();

onLibraryUploadComplete(libraryId.value, () => {
  // Always refresh when uploads complete, regardless of current view mode
  // since uploads always go to the files view
  resetAndFetch();
});

// Track if view toggle was user-initiated
const userToggledView = ref(false);

// Initialize viewMode from route path (for /trash route)
const isTrashRoute = computed(() => route.path.endsWith("/trash"));

if (isTrashRoute.value) {
  viewMode.value = "trash";
}

// Sync viewMode when navigating between /libraries/:id and /libraries/:id/trash
watch(isTrashRoute, (trash) => {
  if (trash && viewMode.value !== "trash") {
    userToggledView.value = true;
    viewMode.value = "trash";
  } else if (!trash && viewMode.value === "trash") {
    userToggledView.value = true;
    viewMode.value = "files";
  }
});

watch(libraryId, () => {
  viewMode.value = "files";
  failedThumbnails.clear();
});

watch(currentFolderId, () => {
  if (viewMode.value === "files") {
    resetAndFetch();
  }
});

watch(viewMode, () => {
  if (userToggledView.value) {
    userToggledView.value = false;
    resetAndFetch();
  }
});

watch(entryViewMode, (next) => {
  localStorage.setItem(ENTRY_VIEW_STORAGE_KEY, next);
});

// Close "New" dropdown on outside click
function handleClickOutsideNewDropdown(event: MouseEvent) {
  const el = newDropdown.value;
  if (el?.open && !el.contains(event.target as Node)) {
    el.open = false;
  }
}

onMounted(() => document.addEventListener("click", handleClickOutsideNewDropdown));
onUnmounted(() => document.removeEventListener("click", handleClickOutsideNewDropdown));

// Infinite scroll observer
const sentinel = ref<HTMLElement | null>(null);

onMounted(() => {
  const stored = localStorage.getItem(ENTRY_VIEW_STORAGE_KEY);
  if (stored === "file" || stored === "card") {
    entryViewMode.value = stored;
  }
});

onMounted(() => {
  const el = sentinel.value;
  if (!el) return;
  const observer = new IntersectionObserver(
    (observerEntries) => {
      if (observerEntries[0]?.isIntersecting && nextCursor.value && !loadingMore.value) {
        loadMore();
      }
    },
    { rootMargin: "200px" },
  );
  observer.observe(el);
  onUnmounted(() => observer.disconnect());
});

onUnmounted(() => removeOnComplete(libraryId.value));

async function saveLibraryName(name: string) {
  await apiFetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { name },
  });
  await refreshLibrary();
}

async function saveLibraryEmoji(emoji: string | null) {
  await apiFetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { emoji: emoji ?? "" },
  });
  await refreshLibrary();
}

function handleRowClick(entry: LibraryEntry, event: MouseEvent) {
  event.preventDefault();
  const isMultiSelect = event.ctrlKey || event.metaKey;

  if (entry.kind === "folder") {
    const folderList = folders.value;
    const clickedIndex = folderList.findIndex((folder) => folder.id === entry.id);
    if (clickedIndex === -1) return;

    selectedFiles.clear();
    lastClickedFileIndex.value = null;

    if (event.shiftKey && lastClickedFolderIndex.value !== null) {
      const start = Math.min(lastClickedFolderIndex.value, clickedIndex);
      const end = Math.max(lastClickedFolderIndex.value, clickedIndex);
      if (!isMultiSelect) {
        selectedFolders.clear();
      }
      for (let i = start; i <= end; i++) {
        selectedFolders.add(folderList[i]!.id);
      }
    } else if (isMultiSelect) {
      if (selectedFolders.has(entry.id)) {
        selectedFolders.delete(entry.id);
      } else {
        selectedFolders.add(entry.id);
      }
    } else {
      clearSelection();
      selectedFolders.add(entry.id);
    }

    lastClickedFolderIndex.value = clickedIndex;
    return;
  }

  const fileList = files.value;
  const clickedIndex = fileList.findIndex((file) => file.id === entry.id);
  if (clickedIndex === -1) return;

  selectedFolders.clear();
  lastClickedFolderIndex.value = null;

  if (event.shiftKey && lastClickedFileIndex.value !== null) {
    const start = Math.min(lastClickedFileIndex.value, clickedIndex);
    const end = Math.max(lastClickedFileIndex.value, clickedIndex);
    if (!isMultiSelect) {
      selectedFiles.clear();
    }
    for (let i = start; i <= end; i++) {
      selectedFiles.add(fileList[i]!.id);
    }
  } else if (isMultiSelect) {
    if (selectedFiles.has(entry.id)) {
      selectedFiles.delete(entry.id);
    } else {
      selectedFiles.add(entry.id);
    }
  } else {
    clearSelection();
    selectedFiles.add(entry.id);
  }

  lastClickedFileIndex.value = clickedIndex;
}

function downloadFiles(ids: string[]) {
  if (ids.length > 1) {
    startZipDownload(ids, []);
    return;
  }
  for (const fid of ids) {
    const link = document.createElement("a");
    link.href = `/api/libraries/${libraryId.value}/files/${fid}`;
    link.download = "";
    link.click();
  }
}

function downloadFolders(folderIds: string[]) {
  startZipDownload([], folderIds);
}

function downloadSelection(fileIds: string[], folderIds: string[]) {
  if (!fileIds.length && !folderIds.length) return;
  if (fileIds.length === 1 && !folderIds.length) {
    downloadFiles(fileIds);
    return;
  }
  startZipDownload(fileIds, folderIds);
}

async function trashFiles(ids: string[]) {
  await apiFetch(`/api/libraries/${libraryId.value}/files/${ids[0]}`, {
    method: "DELETE",
    body: { fileIds: ids },
  });
  ids.forEach((id) => selectedFiles.delete(id));
  entries.value = entries.value.filter(
    (entry) => !(entry.kind === "file" && ids.includes(entry.id)),
  );
  totalCount.value -= ids.length;
  trashedCount.value += ids.length;
}

async function restoreFiles(ids: string[]) {
  await apiFetch(`/api/libraries/${libraryId.value}/files/restore`, {
    method: "POST",
    body: { fileIds: ids },
  });
  ids.forEach((id) => selectedFiles.delete(id));
  entries.value = entries.value.filter(
    (entry) => !(entry.kind === "file" && ids.includes(entry.id)),
  );
  totalCount.value -= ids.length;
  trashedCount.value -= ids.length;
}

async function restoreFolders(ids: string[]) {
  await apiFetch(`/api/libraries/${libraryId.value}/folders/restore`, {
    method: "POST",
    body: { folderIds: ids },
  });
  await Promise.all([resetAndFetch(), refreshTrashedCount()]);
}

function openPurgeModal(ids: string[]) {
  purgeAll.value = false;
  filesToPurge.value = ids;
  foldersToPurge.value = [];
  purgeConfirmation.value = "";
  purgeModalOpen.value = true;
}

function openPurgeFolderModal(ids: string[]) {
  purgeAll.value = false;
  filesToPurge.value = [];
  foldersToPurge.value = ids;
  purgeConfirmation.value = "";
  purgeModalOpen.value = true;
}

function openPurgeAllModal() {
  purgeAll.value = true;
  filesToPurge.value = [];
  foldersToPurge.value = [];
  purgeConfirmation.value = "";
  purgeModalOpen.value = true;
}

async function handlePermanentDelete() {
  if (purgeAll.value) {
    await apiFetch(`/api/libraries/${libraryId.value}/files/purge`, {
      method: "POST",
      body: { all: true },
    });
    entries.value = [];
    nextCursor.value = null;
    totalCount.value = 0;
    trashedCount.value = 0;
  } else {
    await apiFetch(`/api/libraries/${libraryId.value}/files/purge`, {
      method: "POST",
      body: foldersToPurge.value.length
        ? { folderIds: foldersToPurge.value }
        : { fileIds: filesToPurge.value },
    });
    await resetAndFetch();
  }
  purgeModalOpen.value = false;
  purgeConfirmation.value = "";
  filesToPurge.value = [];
  foldersToPurge.value = [];
}

function getContextMenuItems(entry: LibraryEntry) {
  if (entry.kind === "folder") {
    const targetFolderIds = selectedFolders.has(entry.id) ? [...selectedFolders] : [entry.id];
    const folderCount = targetFolderIds.length;

    if (!canManageLibrary.value) {
      if (showTrashed.value) return [];
      return [
        [
          {
            label: "Open",
            icon: "i-lucide-folder-open",
            onSelect: () => openFolder(entry.id),
          },
          {
            label: folderCount > 1 ? `Download ${folderCount} folders as ZIP` : "Download as ZIP",
            icon: "i-lucide-download",
            onSelect: () => downloadFolders(targetFolderIds),
          },
        ],
      ];
    }

    if (showTrashed.value) {
      return [
        [
          {
            label: folderCount > 1 ? `Restore ${folderCount} folders` : "Restore folder",
            icon: "i-lucide-undo-2",
            onSelect: () => restoreFolders(targetFolderIds),
          },
        ],
        [
          {
            label:
              folderCount > 1
                ? `Permanently delete ${folderCount} folders`
                : "Permanently delete folder",
            icon: "i-lucide-trash-2",
            color: "error" as const,
            onSelect: () => openPurgeFolderModal(targetFolderIds),
          },
        ],
      ];
    }

    if (folderCount > 1) {
      return [
        [
          {
            label: `Download ${folderCount} folders as ZIP`,
            icon: "i-lucide-download",
            onSelect: () => downloadFolders(targetFolderIds),
          },
        ],
        [
          {
            label: `Delete ${folderCount} folders`,
            icon: "i-lucide-trash-2",
            color: "error" as const,
            onSelect: () => deleteFolders(targetFolderIds),
          },
        ],
      ];
    }

    const folderTagItems = libraryTags.value.length
      ? libraryTags.value.map((tag) => ({
          label: tag.name,
          icon: isFolderTagAssigned(entry, tag.id) ? "i-lucide-check" : "i-lucide-tag",
          onSelect: () => toggleTagForFolder(entry, tag.id),
        }))
      : [
          {
            label: "No tags yet",
            disabled: true,
          },
        ];

    return [
      [
        {
          label: "Open",
          icon: "i-lucide-folder-open",
          onSelect: () => openFolder(entry.id),
        },
        {
          label: "Download as ZIP",
          icon: "i-lucide-download",
          onSelect: () => downloadFolders([entry.id]),
        },
        {
          label: "Rename",
          icon: "i-lucide-pencil",
          onSelect: () => startEntryRename(entry),
        },
        {
          label: "Move",
          icon: "i-lucide-folder-input",
          onSelect: () => openMoveFolderModal(entry),
        },
        {
          label: "Tags",
          icon: "i-lucide-tags",
          children: folderTagItems,
        },
      ],
      [
        {
          label: "Delete folder",
          icon: "i-lucide-trash-2",
          color: "error" as const,
          onSelect: () => deleteFolder(entry),
        },
      ],
    ];
  }

  const targetIds = selectedFiles.has(entry.id) ? [...selectedFiles] : [entry.id];
  const count = targetIds.length;

  if (!canManageLibrary.value) {
    if (showTrashed.value) return [];
    return [
      [
        {
          label: count > 1 ? `Download ${count} files as ZIP` : "Download",
          icon: "i-lucide-download",
          onSelect: () => downloadFiles(targetIds),
        },
      ],
    ];
  }

  if (showTrashed.value) {
    return [
      [
        {
          label: count > 1 ? `Restore ${count} files` : "Restore",
          icon: "i-lucide-undo-2",
          onSelect: () => restoreFiles(targetIds),
        },
      ],
      [
        {
          label: count > 1 ? `Permanently delete ${count} files` : "Permanently delete",
          icon: "i-lucide-trash-2",
          color: "error" as const,
          onSelect: () => openPurgeModal(targetIds),
        },
      ],
    ];
  }

  const tagItems = libraryTags.value.length
    ? libraryTags.value.map((tag) => ({
        label: tag.name,
        icon: areAllFilesTagged(targetIds, tag.id) ? "i-lucide-check" : "i-lucide-tag",
        onSelect: () => toggleTagForFiles(targetIds, tag.id),
      }))
    : [
        {
          label: "No tags yet",
          disabled: true,
        },
      ];

  return [
    [
      {
        label: count > 1 ? `Download ${count} files as ZIP` : "Download",
        icon: "i-lucide-download",
        onSelect: () => downloadFiles(targetIds),
      },
      {
        label: count > 1 ? `Move ${count} files` : "Move",
        icon: "i-lucide-folder-input",
        onSelect: () => openMoveFilesModal(targetIds),
      },
      ...(count === 1
        ? [
            {
              label: "Rename",
              icon: "i-lucide-pencil",
              onSelect() {
                startEntryRename(entry);
              },
            },
          ]
        : []),
      ...(count === 1 && entry.kind === "file" && entry.mimeType.startsWith("video/")
        ? [
            {
              label: "Clip",
              icon: "i-lucide-scissors",
              onSelect() {
                clipSourceFile.value = entry as LibraryFile;
                clipModalOpen.value = true;
              },
            },
          ]
        : []),
      {
        label: count > 1 ? `Tags (${count} files)` : "Tags",
        icon: "i-lucide-tags",
        children: tagItems,
      },
    ],
    [
      {
        label: count > 1 ? `Delete ${count} files` : "Delete",
        icon: "i-lucide-trash-2",
        color: "error" as const,
        onSelect: () => trashFiles(targetIds),
      },
    ],
  ];
}

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const purgeFileCount = computed(() =>
  purgeAll.value ? totalCount.value : filesToPurge.value.length + foldersToPurge.value.length,
);

const emptyStateTitle = computed(() => {
  if (showTrashed.value) return "Trash is empty";
  if (currentFolderId.value) return "This folder is empty";
  return "No files or folders yet";
});

const emptyStateDescription = computed(() => {
  if (showTrashed.value) return "Deleted files will appear here";
  if (currentFolderId.value) return "Create a folder or upload files to this location";
  return "Upload files or create folders to get started with your library";
});
</script>

<template>
  <div class="flex flex-col gap-4 flex-1 min-h-0">
    <LibraryHeader
      :name="library?.name"
      :emoji="library?.emoji ?? null"
      :can-edit="canManageLibrary"
      @update:name="saveLibraryName"
      @update:emoji="saveLibraryEmoji"
    >
      <template #actions>
        <div id="library-header-actions" class="flex items-center gap-3" />
      </template>
    </LibraryHeader>

    <Teleport to="#library-header-actions">
      <button
        v-if="showTrashed && !filesPending && totalCount > 0"
        class="btn btn-soft btn-error hidden sm:flex"
        @click="openPurgeAllModal()"
      >
        <AppIcon name="i-lucide-trash-2" class="size-4" />
        <span class="hidden sm:inline">Permanently Delete All</span>
      </button>
      <button
        v-if="showTrashed && !filesPending && totalCount > 0"
        class="btn btn-soft btn-error btn-sm sm:hidden"
        title="Delete All"
        @click="openPurgeAllModal()"
      >
        <AppIcon name="i-lucide-trash-2" class="size-4" />
      </button>
      <template v-if="canManageLibrary && !showTrashed">
        <details ref="newDropdown" class="dropdown">
          <summary class="btn btn-outline">
            <AppIcon name="i-lucide-plus" class="size-4" />
            New
          </summary>
          <ul class="dropdown-content menu bg-base-200 rounded-box z-10 w-52 p-2 shadow">
            <li v-for="group in newMenuItems" :key="group.map(i => i.label).join()">
              <a
                v-for="item in group"
                :key="item.label"
                href="#"
                @click.prevent="item.onSelect(); newDropdown!.open = false"
              >
                <AppIcon :name="item.icon" class="size-4" />
                {{ item.label }}
              </a>
            </li>
          </ul>
        </details>
        <button class="btn btn-primary" @click="uploadOpen = true">
          <AppIcon name="i-lucide-upload" class="size-4" />
          Upload
        </button>
      </template>
    </Teleport>

    <div v-if="!showTrashed" class="flex items-center justify-between gap-2">
      <div class="breadcrumbs text-base min-w-0">
        <ul>
          <li v-for="item in breadcrumbItems" :key="item.label">
            <RouterLink :to="item.to">
              <AppIcon v-if="item.icon" :name="item.icon" class="size-4" />
              {{ item.label }}
            </RouterLink>
          </li>
        </ul>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button
          class="btn btn-sm"
          :class="entryViewMode === 'file' ? 'btn-soft btn-primary' : 'btn-ghost'"
          title="File view"
          @click="entryViewMode = 'file'"
        >
          <AppIcon name="i-lucide-list" class="size-4" />
        </button>
        <button
          class="btn btn-sm"
          :class="entryViewMode === 'card' ? 'btn-soft btn-primary' : 'btn-ghost'"
          title="Card view"
          @click="entryViewMode = 'card'"
        >
          <AppIcon name="i-lucide-layout-grid" class="size-4" />
        </button>
      </div>
    </div>

    <div class="rounded-lg overflow-y-auto bg-default/20 flex-1 min-h-0">
      <!-- Skeleton loading state -->
      <template v-if="filesPending">
        <table v-if="entryViewMode === 'file'" class="w-full">
          <thead>
            <tr class="bg-elevated/50">
              <th class="w-12 px-4 py-3" />
              <th class="text-left text-xs font-medium text-muted px-4 py-3">Name</th>
              <th class="text-left text-xs font-medium text-muted px-4 py-3">Tags</th>
              <th class="text-left text-xs font-medium text-muted px-4 py-3 hidden sm:table-cell">Owner</th>
              <th class="text-left text-xs font-medium text-muted px-4 py-3 hidden sm:table-cell">{{ showTrashed ? "Trashed" : "Modified" }}</th>
              <th class="text-right text-xs font-medium text-muted px-4 py-3 hidden sm:table-cell">Size</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in 8" :key="i">
              <td class="px-4 py-3"><div class="skeleton h-5 w-5 rounded" /></td>
              <td class="px-4 py-3"><div class="skeleton h-4 rounded" :style="{ width: `${40 + (i * 17) % 40}%` }" /></td>
              <td class="px-4 py-3"><div class="skeleton h-3 w-8 rounded-full" /></td>
              <td class="px-4 py-3 hidden sm:table-cell"><div class="skeleton h-6 w-6 rounded-full" /></td>
              <td class="px-4 py-3 hidden sm:table-cell"><div class="skeleton h-4 w-20 rounded" /></td>
              <td class="px-4 py-3 hidden sm:table-cell"><div class="skeleton h-4 w-14 rounded ml-auto" /></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div v-for="i in 8" :key="i" class="rounded-lg bg-elevated/50 p-3">
            <div class="skeleton h-40 w-full rounded-md mb-3" />
            <div class="skeleton h-4 rounded mb-2" :style="{ width: `${50 + (i * 13) % 40}%` }" />
            <div class="skeleton h-3 w-16 rounded" />
          </div>
        </div>
      </template>

      <table v-else-if="entryViewMode === 'file'" class="w-full">
        <thead>
          <tr class="bg-elevated/50">
            <th class="w-12 px-4 py-3" />
            <th class="text-left text-xs font-medium text-muted px-4 py-3">Name</th>
            <th class="text-left text-xs font-medium text-muted px-4 py-3">Tags</th>
            <th class="text-left text-xs font-medium text-muted px-4 py-3 hidden sm:table-cell">
              Owner
            </th>
            <th class="text-left text-xs font-medium text-muted px-4 py-3 hidden sm:table-cell">
              {{ showTrashed ? "Trashed" : "Modified" }}
            </th>
            <th class="text-right text-xs font-medium text-muted px-4 py-3 hidden sm:table-cell">
              Size
            </th>
          </tr>
        </thead>
        <tbody class="select-none">
          <template v-for="entry in entries ?? []" :key="`${entry.kind}-${entry.id}`">
            <tr
              class="cursor-pointer transition-colors"
              :class="[
                isEntrySelected(entry) ? 'bg-primary/10' : 'hover:bg-base-300/50',
                dropTargetFolderId === entry.id && entry.kind === 'folder'
                  ? 'ring-2 ring-primary/60 ring-inset bg-primary/5'
                  : '',
                draggedFileIds.includes(entry.id) && entry.kind === 'file' ? 'opacity-60' : '',
              ]"
              :draggable="dragEnabled && entry.kind === 'file' && !isRenaming(entry)"
              @click="handleRowClick(entry, $event)"
              @dblclick="openEntry(entry)"
              @dragstart="handleFileDragStart(entry, $event)"
              @dragend="handleFileDragEnd"
              @dragenter="handleFolderDragEnter(entry)"
              @dragover="handleFolderDragOver(entry, $event)"
              @dragleave="handleFolderDragLeave(entry, $event)"
              @drop="handleFolderDrop(entry, $event)"
            >
              <td class="px-4 py-3">
                <div class="flex items-center justify-center">
                  <AppIcon
                    :name="
                      entry.kind === 'folder' ? 'i-lucide-folder' : getMimeIcon(entry.mimeType)
                    "
                    class="size-5 text-muted"
                    :class="showTrashed && entry.kind === 'file' ? 'opacity-50' : ''"
                  />
                </div>
              </td>
              <td class="px-4 py-3">
                <div
                  v-if="isRenaming(entry)"
                  :data-rename-input-entry-id="entry.id"
                >
                  <input
                    v-model="renameValue"
                    class="input input-sm w-full"
                    autofocus
                    @blur="saveEntryRename(entry)"
                    @keydown.enter="saveEntryRename(entry)"
                    @keydown.escape="renamingEntry = null"
                    @click.stop
                  />
                </div>
                <div v-else class="flex items-center gap-1">
                  <button
                    v-if="entry.kind === 'folder'"
                    type="button"
                    class="text-sm text-left hover:text-primary transition-colors"
                    @click.stop="openFolder(entry.id)"
                  >
                    {{
                      showTrashed
                        ? `${entry.name} (${entry.trashFileCount ?? 0} files)`
                        : entry.name
                    }}
                  </button>
                  <button
                    v-else
                    type="button"
                    class="text-sm text-left hover:text-primary transition-colors"
                    :class="showTrashed ? 'opacity-60' : ''"
                    @click.stop="canManageLibrary ? startEntryRename(entry) : openPreview(entry)"
                  >
                    {{ entry.name }}
                  </button>
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="tag in entry.tags"
                    :key="tag.id"
                    class="size-2.5 rounded-full border border-default/50"
                    :title="tag.name"
                    :style="{ backgroundColor: tag.color }"
                  />
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-muted hidden sm:table-cell">
                <div v-if="entry.kind === 'file' && entry.owner" class="flex items-center">
                  <div class="avatar" :title="entry.owner.displayName">
                    <div class="w-6 rounded-full">
                      <img
                        v-if="entry.owner.avatarUrl"
                        :src="entry.owner.avatarUrl"
                        :alt="entry.owner.displayName"
                      />
                    </div>
                  </div>
                </div>
                <span v-else>-</span>
              </td>
              <td class="px-4 py-3 text-sm text-muted hidden sm:table-cell">
                {{
                  showTrashed && entry.trashedAt
                    ? formatDate(entry.trashedAt)
                    : formatDate(entry.updatedAt)
                }}
              </td>
              <td class="px-4 py-3 text-sm text-muted text-right hidden sm:table-cell">
                {{ entry.kind === "folder" ? "-" : formatFileSize(entry.size) }}
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <div
        v-else-if="entryViewMode === 'card' && (entries?.length ?? 0) > 0"
        class="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
      >
        <template v-for="entry in entries ?? []" :key="`${entry.kind}-${entry.id}`">
          <div
            class="rounded-lg bg-elevated/50 p-3 cursor-pointer transition-colors select-none"
            :class="[
              isEntrySelected(entry)
                ? 'ring-2 ring-primary/50 bg-primary/5'
                : 'hover:bg-base-300/50',
              dropTargetFolderId === entry.id && entry.kind === 'folder'
                ? 'ring-2 ring-primary/60 bg-primary/10'
                : '',
              draggedFileIds.includes(entry.id) && entry.kind === 'file' ? 'opacity-60' : '',
            ]"
            :draggable="dragEnabled && entry.kind === 'file' && !isRenaming(entry)"
            @click="handleRowClick(entry, $event)"
            @dblclick="openEntry(entry)"
            @dragstart="handleFileDragStart(entry, $event)"
            @dragend="handleFileDragEnd"
            @dragenter="handleFolderDragEnter(entry)"
            @dragover="handleFolderDragOver(entry, $event)"
            @dragleave="handleFolderDragLeave(entry, $event)"
            @drop="handleFolderDrop(entry, $event)"
          >
            <div
              class="h-40 rounded-md bg-elevated mb-3 flex items-center justify-center overflow-hidden"
            >
              <template v-if="entry.kind === 'folder'">
                <AppIcon name="i-lucide-folder" class="size-10 text-muted" />
              </template>
              <template v-else-if="entry.kind === 'file' && entry.mimeType.startsWith('video/')">
                <div class="relative w-full h-full flex items-center justify-center">
                  <img
                    v-if="!failedThumbnails.has(entry.id)"
                    :src="`/api/libraries/${libraryId}/files/${entry.id}/thumbnail`"
                    :alt="entry.name"
                    class="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    @error="failedThumbnails.add(entry.id)"
                  />
                  <AppIcon
                    v-else
                    name="i-lucide-film"
                    class="size-10 text-muted"
                  />
                  <div
                    v-if="entry.proxyStatus === 'processing'"
                    class="absolute inset-0 flex items-center justify-center bg-black/40"
                  >
                    <span class="loading loading-spinner loading-sm text-white"></span>
                  </div>
                </div>
              </template>
              <template v-else-if="isImageFile(entry)">
                <AlcovesImage
                  v-if="!failedThumbnails.has(entry.id)"
                  :library-id="libraryId || ''"
                  :file-id="entry.id"
                  :alt="entry.name"
                  :width="cardThumbWidth(entry)"
                  :height="cardThumbHeight(entry)"
                  format="jpeg"
                  :quality="82"
                  :class="isSmallImage(entry) ? 'object-contain' : 'w-full h-full object-cover'"
                  @error="failedThumbnails.add(entry.id)"
                />
                <AppIcon
                  v-else
                  name="i-lucide-image"
                  class="size-10 text-muted"
                />
              </template>
              <template v-else>
                <AppIcon
                  :name="getMimeIcon(entry.mimeType)"
                  class="size-10 text-muted"
                  :class="showTrashed ? 'opacity-50' : ''"
                />
              </template>
            </div>

            <div
              v-if="isRenaming(entry)"
              :data-rename-input-entry-id="entry.id"
            >
              <input
                v-model="renameValue"
                class="input input-sm w-full"
                autofocus
                @blur="saveEntryRename(entry)"
                @keydown.enter="saveEntryRename(entry)"
                @keydown.escape="renamingEntry = null"
                @click.stop
              />
            </div>
            <div v-else>
              <button
                v-if="entry.kind === 'folder'"
                type="button"
                class="text-sm font-medium text-left truncate w-full hover:text-primary transition-colors"
                @click.stop="openFolder(entry.id)"
              >
                {{
                  showTrashed ? `${entry.name} (${entry.trashFileCount ?? 0} files)` : entry.name
                }}
              </button>
              <button
                v-else
                type="button"
                class="text-sm font-medium text-left truncate w-full hover:text-primary transition-colors"
                :class="showTrashed ? 'opacity-60' : ''"
                @click.stop="canManageLibrary ? startEntryRename(entry) : openPreview(entry)"
              >
                {{ entry.name }}
              </button>

              <div class="flex items-center justify-between mt-1 gap-2 text-xs text-muted">
                <span>{{
                  showTrashed && entry.trashedAt
                    ? formatDate(entry.trashedAt)
                    : formatDate(entry.updatedAt)
                }}</span>
                <span>{{ entry.kind === "folder" ? "-" : formatFileSize(entry.size) }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-1.5 mt-2">
                <span
                  v-for="tag in entry.tags"
                  :key="tag.id"
                  class="size-2.5 rounded-full border border-default/50"
                  :title="tag.name"
                  :style="{ backgroundColor: tag.color }"
                />
              </div>
            </div>
          </div>
        </template>
      </div>

      <div
        v-if="(entries?.length ?? 0) === 0 && !filesPending"
        class="flex flex-col items-center justify-center py-16 px-4"
      >
        <div
          class="size-16 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center mb-4"
        >
          <AppIcon
            :name="showTrashed ? 'i-lucide-trash-2' : 'i-lucide-folder-open'"
            class="size-8 text-(--ui-text-muted)"
          />
        </div>
        <p class="text-lg font-medium text-foreground mb-1">{{ emptyStateTitle }}</p>
        <p class="text-sm text-muted mb-4">{{ emptyStateDescription }}</p>
        <div v-if="canManageLibrary && !showTrashed" class="flex items-center gap-2">
          <button
            class="btn btn-outline"
            @click="openCreateFolderModal"
          >
            <AppIcon name="i-lucide-folder-plus" class="size-4" />
            Create folder
          </button>
          <button class="btn btn-primary" @click="uploadOpen = true">
            <AppIcon name="i-lucide-upload" class="size-4" />
            Upload files
          </button>
        </div>
      </div>

      <div ref="sentinel" class="h-px" />
      <div v-if="loadingMore" class="flex items-center justify-center py-4">
        <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>
    </div>

    <UploadModal
      v-model:open="uploadOpen"
      :library-id="libraryId || ''"
      :library-name="library?.name ?? 'Library'"
      :parent-folder-id="showTrashed ? null : currentFolderId"
    />

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId || ''"
      :files="files"
      @navigate="previewFile = $event"
      @update:file="handleFileUpdate"
    />

    <ClipModal
      v-if="clipSourceFile"
      v-model:open="clipModalOpen"
      :file="clipSourceFile"
      :library-id="libraryId || ''"
      @created="resetAndFetch()"
    />

    <!-- Create Folder Modal -->
    <dialog class="modal" :class="{ 'modal-open': createFolderOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Create Folder</h3>
        <div class="flex flex-col gap-4 mt-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Folder name</legend>
            <input
              v-model="createFolderName"
              autofocus
              placeholder="New folder"
              class="input w-full"
              @keydown.enter="createFolder"
            />
          </fieldset>
        </div>
        <div class="modal-action">
          <button
            class="btn btn-outline"
            @click="createFolderOpen = false"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="!createFolderName.trim() || creatingFolder"
            @click="createFolder"
          >
            <span v-if="creatingFolder" class="loading loading-spinner loading-xs"></span>
            <AppIcon v-else name="i-lucide-folder-plus" class="size-4" />
            Create
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="createFolderOpen = false">close</button>
      </form>
    </dialog>

    <!-- Move Folder Modal -->
    <dialog class="modal" :class="{ 'modal-open': moveFolderOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Move Folder</h3>
        <div class="flex flex-col gap-4 mt-4">
          <p class="text-sm text-muted">
            Move
            <strong>{{ movingFolder?.name }}</strong>
            to a new location.
          </p>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Destination</legend>
            <select
              v-model="moveDestinationValue"
              class="select w-full"
              :disabled="moveLoading"
            >
              <option
                v-for="item in moveDestinationOptions"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </option>
            </select>
          </fieldset>
        </div>
        <div class="modal-action">
          <button
            class="btn btn-outline"
            @click="moveFolderOpen = false"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="moveLoading || moveFolderSaving"
            @click="moveFolder"
          >
            <span v-if="moveFolderSaving" class="loading loading-spinner loading-xs"></span>
            <AppIcon v-else name="i-lucide-folder-input" class="size-4" />
            Move
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="moveFolderOpen = false">close</button>
      </form>
    </dialog>

    <!-- Move Files Modal -->
    <dialog class="modal" :class="{ 'modal-open': moveFilesOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Move Files</h3>
        <div class="flex flex-col gap-4 mt-4">
          <p class="text-sm text-muted">
            Move
            <strong>{{ moveFileCount }}</strong>
            {{ moveFileCount === 1 ? "file" : "files" }} to a new location.
          </p>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Destination</legend>
            <select
              v-model="moveFilesDestinationValue"
              class="select w-full"
              :disabled="moveFilesLoading"
            >
              <option
                v-for="item in moveFileDestinationOptions"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </option>
            </select>
          </fieldset>
        </div>
        <div class="modal-action">
          <button class="btn btn-outline" @click="closeMoveFilesModal">
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="moveFilesLoading || moveFilesSaving"
            @click="moveFiles"
          >
            <span v-if="moveFilesSaving" class="loading loading-spinner loading-xs"></span>
            <AppIcon v-else name="i-lucide-folder-input" class="size-4" />
            Move
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeMoveFilesModal">close</button>
      </form>
    </dialog>

    <!-- Permanently Delete Items Modal -->
    <dialog class="modal" :class="{ 'modal-open': purgeModalOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Permanently Delete Items</h3>
        <div class="flex flex-col gap-4 mt-4">
          <p class="text-sm text-muted">
            This will permanently delete
            <strong>{{ purgeFileCount }}</strong>
            {{ purgeFileCount === 1 ? "item" : "items" }} from disk. This action cannot be undone.
          </p>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Type 'delete' to confirm</legend>
            <input v-model="purgeConfirmation" placeholder="delete" class="input w-full" />
          </fieldset>
        </div>
        <div class="modal-action">
          <button
            class="btn btn-outline"
            @click="purgeModalOpen = false"
          >
            Cancel
          </button>
          <button
            class="btn btn-error"
            :disabled="purgeConfirmation !== 'delete'"
            @click="handlePermanentDelete"
          >
            <AppIcon name="i-lucide-trash-2" class="size-4" />
            Delete Permanently
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="purgeModalOpen = false">close</button>
      </form>
    </dialog>

    <!-- Large Download Warning Modal -->
    <dialog class="modal" :class="{ 'modal-open': showSizeWarning }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Large Download Warning</h3>
        <div class="flex flex-col gap-3 mt-4">
          <div
            class="flex items-center gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20"
          >
            <AppIcon name="i-lucide-alert-triangle" class="size-5 text-warning shrink-0" />
            <p class="text-sm">This download is very large and may take a while.</p>
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p class="text-muted">Estimated Size</p>
              <p class="font-medium">{{ formattedEstimatedSize }}</p>
            </div>
            <div>
              <p class="text-muted">Files</p>
              <p class="font-medium">{{ estimatedFileCount.toLocaleString("en-US") }}</p>
            </div>
          </div>
        </div>
        <div class="modal-action">
          <button class="btn btn-outline" @click="cancelLargeDownload">
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="zipDownloading"
            @click="confirmLargeDownload"
          >
            <span v-if="zipDownloading" class="loading loading-spinner loading-xs"></span>
            <AppIcon v-else name="i-lucide-download" class="size-4" />
            Download Anyway
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="cancelLargeDownload">close</button>
      </form>
    </dialog>
  </div>
</template>
