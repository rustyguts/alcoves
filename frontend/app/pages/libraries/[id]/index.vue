<script setup lang="ts">
import type { ContextMenuItem, DropdownMenuItem, BreadcrumbItem } from "@nuxt/ui";
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";
import { getMimeIcon, formatFileSize, formatDate } from "~/utils/mime-icons";
import { apiFetch } from "~/utils/api-fetch";
import { useLibraryExplorer } from "~/composables/useLibraryExplorer";
import { useLibraryTags } from "~/composables/useLibraryTags";
import { useDownloadZip } from "~/composables/useDownloadZip";
import { useLibraryFolderActions } from "~/composables/useLibraryFolderActions";
import { useUploadQueue } from "~/composables/useUploadQueue";

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

const editingName = ref(false);
const editName = ref("");
const renamingEntry = ref<LibraryEntry | null>(null);
const renameValue = ref("");
const uploadOpen = ref(false);
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

const breadcrumbItems = computed<BreadcrumbItem[]>(() => {
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

const newMenuItems = computed<DropdownMenuItem[][]>(() => [
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
  if (viewMode.value === "files") resetAndFetch();
});

// Track if view toggle was user-initiated
const userToggledView = ref(false);

watch(libraryId, () => {
  viewMode.value = "files";
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

function startLibraryRename() {
  if (!canManageLibrary.value) return;
  editName.value = library.value?.name ?? "";
  editingName.value = true;
}

async function saveLibraryName() {
  if (!canManageLibrary.value) return;
  editingName.value = false;
  if (!editName.value.trim() || editName.value === library.value?.name) return;
  await apiFetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { name: editName.value.trim() },
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

function getContextMenuItems(entry: LibraryEntry): ContextMenuItem[][] {
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

    const folderTagItems: ContextMenuItem[] = libraryTags.value.length
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

  const tagItems: ContextMenuItem[] = libraryTags.value.length
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
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-3 min-h-10">
      <div class="flex items-center gap-2">
        <h1
          v-if="!editingName"
          class="text-xl font-semibold"
          :class="canManageLibrary ? 'cursor-pointer hover:text-primary' : ''"
          @click="startLibraryRename"
        >
          {{ library?.name }}
        </h1>
        <UInput
          v-else
          v-model="editName"
          autofocus
          size="lg"
          @blur="saveLibraryName"
          @keydown.enter="saveLibraryName"
          @keydown.escape="editingName = false"
        />
      </div>
      <div class="flex items-center gap-3">
        <UButton
          v-if="showTrashed && !filesPending && totalCount > 0"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          class="hidden sm:flex"
          @click="openPurgeAllModal()"
        >
          <span class="hidden sm:inline">Permanently Delete All</span>
        </UButton>
        <UButton
          v-if="showTrashed && !filesPending && totalCount > 0"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          class="sm:hidden"
          title="Delete All"
          @click="openPurgeAllModal()"
        />
        <template v-if="canManageLibrary && !showTrashed">
          <UDropdownMenu :items="newMenuItems">
            <UButton icon="i-lucide-plus" label="New" color="neutral" variant="outline" />
          </UDropdownMenu>
          <UButton icon="i-lucide-upload" label="Upload" @click="uploadOpen = true" />
        </template>
      </div>
    </div>

    <UBreadcrumb v-if="!showTrashed" :items="breadcrumbItems" />

    <div class="flex flex-wrap items-center justify-between gap-2 w-full">
      <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide">
        <UButton
          label="Files"
          icon="i-lucide-folder"
          :variant="!showTrashed ? 'soft' : 'ghost'"
          :color="!showTrashed ? 'primary' : 'neutral'"
          size="sm"
          @click="
            userToggledView = true;
            viewMode = 'files';
          "
        />
        <UButton
          label="Tags"
          icon="i-lucide-tags"
          variant="ghost"
          color="neutral"
          size="sm"
          :to="`/libraries/${libraryId}/tags`"
        />
        <UButton
          v-if="library?.faceRecognitionEnabled"
          label="People"
          icon="i-lucide-scan-face"
          variant="ghost"
          color="neutral"
          size="sm"
          :to="`/libraries/${libraryId}/people`"
        />
      </div>
      <div class="flex items-center gap-1">
        <div v-if="!showTrashed" class="inline-flex items-center">
          <UButton
            icon="i-lucide-list"
            size="sm"
            :variant="entryViewMode === 'file' ? 'soft' : 'ghost'"
            :color="entryViewMode === 'file' ? 'primary' : 'neutral'"
            title="File view"
            @click="entryViewMode = 'file'"
          />
          <UButton
            icon="i-lucide-layout-grid"
            size="sm"
            :variant="entryViewMode === 'card' ? 'soft' : 'ghost'"
            :color="entryViewMode === 'card' ? 'primary' : 'neutral'"
            title="Card view"
            @click="entryViewMode = 'card'"
          />
        </div>
        <UButton
          label="Trash"
          icon="i-lucide-trash-2"
          :variant="showTrashed ? 'soft' : 'ghost'"
          :color="'error'"
          size="sm"
          @click="
            userToggledView = true;
            viewMode = 'trash';
          "
        />
        <UButton
          v-if="canManageLibrary"
          icon="i-lucide-settings"
          color="neutral"
          variant="ghost"
          size="sm"
          :to="`/libraries/${libraryId}/settings`"
          title="Settings"
        />
      </div>
    </div>

    <div class="rounded-lg overflow-hidden bg-default/20">
      <table v-if="entryViewMode === 'file'" class="w-full">
        <thead>
          <tr class="bg-elevated/50">
            <th class="w-10 px-3 py-2" />
            <th class="text-left text-xs font-medium text-muted px-3 py-2">Name</th>
            <th class="text-left text-xs font-medium text-muted px-3 py-2">Tags</th>
            <th class="text-left text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">
              Owner
            </th>
            <th class="text-left text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">
              {{ showTrashed ? "Trashed" : "Modified" }}
            </th>
            <th class="text-right text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">
              Size
            </th>
          </tr>
        </thead>
        <tbody class="select-none">
          <template v-for="entry in entries ?? []" :key="`${entry.kind}-${entry.id}`">
            <UContextMenu :items="getContextMenuItems(entry)">
              <tr
                class="cursor-pointer transition-colors"
                :class="[
                  isEntrySelected(entry) ? 'bg-primary/10' : 'hover:bg-elevated/50',
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
                <td class="px-3 py-2">
                  <div class="flex items-center justify-center">
                    <UIcon
                      :name="
                        entry.kind === 'folder' ? 'i-lucide-folder' : getMimeIcon(entry.mimeType)
                      "
                      class="size-5 text-muted"
                      :class="showTrashed && entry.kind === 'file' ? 'opacity-50' : ''"
                    />
                  </div>
                </td>
                <td class="px-3 py-2">
                  <UInput
                    v-if="isRenaming(entry)"
                    v-model="renameValue"
                    :data-rename-input-entry-id="entry.id"
                    size="sm"
                    autofocus
                    @blur="saveEntryRename(entry)"
                    @keydown.enter="saveEntryRename(entry)"
                    @keydown.escape="renamingEntry = null"
                    @click.stop
                  />
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
                <td class="px-3 py-2">
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
                <td class="px-3 py-2 text-sm text-muted hidden sm:table-cell">
                  <div v-if="entry.kind === 'file' && entry.owner" class="flex items-center">
                    <UAvatar
                      :src="entry.owner.avatarUrl ?? undefined"
                      :alt="entry.owner.displayName"
                      size="xs"
                      :title="entry.owner.displayName"
                    />
                  </div>
                  <span v-else>-</span>
                </td>
                <td class="px-3 py-2 text-sm text-muted hidden sm:table-cell">
                  {{
                    showTrashed && entry.trashedAt
                      ? formatDate(entry.trashedAt)
                      : formatDate(entry.updatedAt)
                  }}
                </td>
                <td class="px-3 py-2 text-sm text-muted text-right hidden sm:table-cell">
                  {{ entry.kind === "folder" ? "-" : formatFileSize(entry.size) }}
                </td>
              </tr>
            </UContextMenu>
          </template>
        </tbody>
      </table>

      <div
        v-else-if="entryViewMode === 'card' && (entries?.length ?? 0) > 0"
        class="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
      >
        <template v-for="entry in entries ?? []" :key="`${entry.kind}-${entry.id}`">
          <UContextMenu :items="getContextMenuItems(entry)">
            <div
              class="rounded-lg bg-elevated/50 p-3 cursor-pointer transition-colors select-none"
              :class="[
                isEntrySelected(entry)
                  ? 'ring-2 ring-primary/50 bg-primary/5'
                  : 'hover:bg-elevated/70',
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
                class="h-28 rounded-md bg-elevated mb-3 flex items-center justify-center overflow-hidden"
              >
                <template v-if="entry.kind === 'folder'">
                  <UIcon name="i-lucide-folder" class="size-10 text-muted" />
                </template>
                <template v-else-if="entry.kind === 'file' && entry.mimeType.startsWith('video/')">
                  <img
                    :src="`/api/libraries/${libraryId}/files/${entry.id}/thumbnail`"
                    :alt="entry.name"
                    class="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  />
                </template>
                <template v-else-if="isImageFile(entry)">
                  <AlcovesImage
                    :library-id="libraryId || ''"
                    :file-id="entry.id"
                    :alt="entry.name"
                    :width="720"
                    :height="360"
                    format="jpeg"
                    :quality="82"
                    class="w-full h-full object-cover"
                  />
                </template>
                <template v-else>
                  <UIcon
                    :name="getMimeIcon(entry.mimeType)"
                    class="size-10 text-muted"
                    :class="showTrashed ? 'opacity-50' : ''"
                  />
                </template>
              </div>

              <UInput
                v-if="isRenaming(entry)"
                v-model="renameValue"
                :data-rename-input-entry-id="entry.id"
                size="sm"
                autofocus
                @blur="saveEntryRename(entry)"
                @keydown.enter="saveEntryRename(entry)"
                @keydown.escape="renamingEntry = null"
                @click.stop
              />
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
          </UContextMenu>
        </template>
      </div>

      <div
        v-if="(entries?.length ?? 0) === 0 && !filesPending"
        class="flex flex-col items-center justify-center py-16 px-4"
      >
        <div
          class="size-16 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center mb-4"
        >
          <UIcon
            :name="showTrashed ? 'i-lucide-trash-2' : 'i-lucide-folder-open'"
            class="size-8 text-(--ui-text-muted)"
          />
        </div>
        <p class="text-lg font-medium text-foreground mb-1">{{ emptyStateTitle }}</p>
        <p class="text-sm text-muted mb-4">{{ emptyStateDescription }}</p>
        <div v-if="canManageLibrary && !showTrashed" class="flex items-center gap-2">
          <UButton
            icon="i-lucide-folder-plus"
            label="Create folder"
            color="neutral"
            variant="outline"
            @click="openCreateFolderModal"
          />
          <UButton icon="i-lucide-upload" label="Upload files" @click="uploadOpen = true" />
        </div>
      </div>

      <div ref="sentinel" class="h-px" />
      <div v-if="loadingMore" class="flex items-center justify-center py-4">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
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
    />

    <ClipModal
      v-if="clipSourceFile"
      v-model:open="clipModalOpen"
      :file="clipSourceFile"
      :library-id="libraryId || ''"
      @created="resetAndFetch()"
    />

    <UModal v-model:open="createFolderOpen" title="Create Folder">
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField label="Folder name">
            <UInput
              v-model="createFolderName"
              autofocus
              placeholder="New folder"
              class="w-full"
              @keydown.enter="createFolder"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="createFolderOpen = false"
          />
          <UButton
            label="Create"
            icon="i-lucide-folder-plus"
            :loading="creatingFolder"
            :disabled="!createFolderName.trim()"
            @click="createFolder"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="moveFolderOpen" title="Move Folder">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            Move
            <strong>{{ movingFolder?.name }}</strong>
            to a new location.
          </p>
          <UFormField label="Destination">
            <USelectMenu
              v-model="moveDestinationValue"
              :items="moveDestinationOptions"
              value-key="value"
              class="w-full"
              :loading="moveLoading"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="moveFolderOpen = false"
          />
          <UButton
            label="Move"
            icon="i-lucide-folder-input"
            :loading="moveFolderSaving"
            :disabled="moveLoading"
            @click="moveFolder"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="moveFilesOpen" title="Move Files">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            Move
            <strong>{{ moveFileCount }}</strong>
            {{ moveFileCount === 1 ? "file" : "files" }} to a new location.
          </p>
          <UFormField label="Destination">
            <USelectMenu
              v-model="moveFilesDestinationValue"
              :items="moveFileDestinationOptions"
              value-key="value"
              class="w-full"
              :loading="moveFilesLoading"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="outline" @click="closeMoveFilesModal" />
          <UButton
            label="Move"
            icon="i-lucide-folder-input"
            :loading="moveFilesSaving"
            :disabled="moveFilesLoading"
            @click="moveFiles"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="purgeModalOpen" title="Permanently Delete Items">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            This will permanently delete
            <strong>{{ purgeFileCount }}</strong>
            {{ purgeFileCount === 1 ? "item" : "items" }} from disk. This action cannot be undone.
          </p>
          <UFormField label="Type 'delete' to confirm">
            <UInput v-model="purgeConfirmation" placeholder="delete" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="purgeModalOpen = false"
          />
          <UButton
            label="Delete Permanently"
            color="error"
            icon="i-lucide-trash-2"
            :disabled="purgeConfirmation !== 'delete'"
            @click="handlePermanentDelete"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showSizeWarning" title="Large Download Warning">
      <template #body>
        <div class="flex flex-col gap-3">
          <div
            class="flex items-center gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20"
          >
            <UIcon name="i-lucide-alert-triangle" class="size-5 text-warning shrink-0" />
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
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="outline" @click="cancelLargeDownload" />
          <UButton
            label="Download Anyway"
            icon="i-lucide-download"
            :loading="zipDownloading"
            @click="confirmLargeDownload"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
