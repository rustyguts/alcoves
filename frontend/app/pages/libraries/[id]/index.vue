<script setup lang="ts">
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";
import { getMimeIcon, formatFileSize, formatDate } from "~/utils/mime-icons";
import { apiFetch } from "~/utils/api-fetch";
import { useLibraryExplorer } from "~/composables/useLibraryExplorer";
import { useLibraryTags } from "~/composables/useLibraryTags";
import { useDownloadZip } from "~/composables/useDownloadZip";
import { useLibraryFolderActions } from "~/composables/useLibraryFolderActions";
import { useUploadQueue } from "~/composables/useUploadQueue";
import { useFileDrop } from "~/composables/useFileDrop";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";
import ContextMenuItemsRenderer from "~/components/ContextMenuItemsRenderer.vue";
import UploadModal from "~/components/UploadModal.vue";
import FilePreview from "~/components/FilePreview.vue";
import ClipModal from "~/components/ClipModal.vue";
import AlcovesImage from "~/components/AlcovesImage.vue";
import AppContextMenu from "~/components/AppContextMenu.vue";
import LibraryEntriesGrid from "~/components/library/LibraryEntriesGrid.vue";
import LibraryEmptyState from "~/components/library/LibraryEmptyState.vue";
import LibraryEntriesTable from "~/components/library/LibraryEntriesTable.vue";
import LibraryTabs from "~/components/LibraryTabs.vue";

const ENTRY_VIEW_STORAGE_KEY = "alcoves.library.entry-view";
const ROOT_MOVE_VALUE = "__root__";

const toast = useToast();

const {
  route,
  libraryId,
  user,
  library,
  isTrashRoute,
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
  lastClickedIndex,
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
const createFolderInput = ref<HTMLInputElement | null>(null);
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

// Context menu state
type ContextMenuItem = {
  label: string;
  icon?: string;
  color?: "error";
  disabled?: boolean;
  children?: ContextMenuItem[];
  onSelect?: () => void;
};

const contextMenuEntry = ref<LibraryEntry | null>(null);
const contextMenuPosition = ref<{ x: number; y: number } | null>(null);

function showContextMenu(entry: LibraryEntry, event: MouseEvent) {
  event.preventDefault();
  contextMenuEntry.value = entry;
  contextMenuPosition.value = { x: event.clientX, y: event.clientY };
}

function hideContextMenu() {
  contextMenuEntry.value = null;
  contextMenuPosition.value = null;
}

function handleContextMenuSelect(item: ContextMenuItem) {
  if (item.disabled) return;
  item.onSelect?.();
  hideContextMenu();
}

// Close context menu on escape or click outside
onMounted(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") hideContextMenu();
  };
  window.addEventListener("keydown", handleEscape);
  onUnmounted(() => window.removeEventListener("keydown", handleEscape));
});

function buildBreadcrumbUrl(folderId: string | null): string {
  const basePath = `/libraries/${libraryId.value}`;
  if (!folderId) return basePath;
  return `${basePath}?folder=${encodeURIComponent(folderId)}`;
}

const breadcrumbItems = computed<
  Array<{
    id: string;
    label: string;
    to: string;
    isCurrent: boolean;
  }>
>(() => {
  const folderCrumbs = breadcrumbs.value.map((crumb, index) => ({
    id: crumb.id,
    label: crumb.name,
    to: buildBreadcrumbUrl(crumb.id),
    isCurrent: index === breadcrumbs.value.length - 1,
  }));

  return [
    {
      id: "__root__",
      label: library.value?.name ?? "Library",
      to: buildBreadcrumbUrl(null),
      isCurrent: folderCrumbs.length === 0 || showTrashed.value,
    },
    ...(showTrashed.value ? [] : folderCrumbs),
  ];
});

const newMenuItems = computed<Array<Array<{ label: string; icon: string; onSelect: () => void }>>>(
  () => [
    [
      {
        label: "Upload",
        icon: "i-lucide-upload",
        onSelect: () => {
          uploadOpen.value = true;
        },
      },
      {
        label: "Folder",
        icon: "i-lucide-folder-plus",
        onSelect: openCreateFolderModal,
      },
    ],
  ],
);

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
const { addFiles, onLibraryUploadComplete, removeOnComplete, onLibraryUploadSuccess, removeOnSuccess } =
  useUploadQueue();

const UPLOAD_REFRESH_DEBOUNCE_MS = 3_000;
const lastUploadRefreshAt = ref(0);
let uploadRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function refreshAfterUploadDebounced() {
  const now = Date.now();
  const elapsed = now - lastUploadRefreshAt.value;

  if (elapsed >= UPLOAD_REFRESH_DEBOUNCE_MS && !uploadRefreshTimer) {
    lastUploadRefreshAt.value = now;
    void resetAndFetch();
    return;
  }

  if (uploadRefreshTimer) return;

  uploadRefreshTimer = setTimeout(() => {
    uploadRefreshTimer = null;
    lastUploadRefreshAt.value = Date.now();
    void resetAndFetch();
  }, Math.max(UPLOAD_REFRESH_DEBOUNCE_MS - elapsed, 0));
}

const canDropUpload = computed(() => canManageLibrary.value && !showTrashed.value);

const { isOverDropZone: isFileDragActive, dropZoneProps: fileDropZoneProps } = useFileDrop({
  enabled: canDropUpload,
  onDrop(droppedFiles) {
    addFiles(droppedFiles, libraryId.value, library.value?.name ?? "Library", currentFolderId.value);
    toast.add({
      title: `${droppedFiles.length} file${droppedFiles.length === 1 ? "" : "s"} added to upload queue`,
    });
  },
});

onLibraryUploadSuccess(libraryId.value, refreshAfterUploadDebounced);
onLibraryUploadComplete(libraryId.value, refreshAfterUploadDebounced);

// Sync viewMode when navigating between /libraries/:id and /libraries/:id/trash
watch(isTrashRoute, (trash) => {
  if (trash && viewMode.value !== "trash") {
    viewMode.value = "trash";
    resetAndFetch({ preserveEntries: true });
  } else if (!trash && viewMode.value === "trash") {
    viewMode.value = "files";
    resetAndFetch({ preserveEntries: true });
  }
});

watch(libraryId, () => {
  viewMode.value = "files";
  failedThumbnails.clear();
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

watch(createFolderOpen, async (open) => {
  if (!open) return;
  await nextTick();
  requestAnimationFrame(() => {
    createFolderInput.value?.focus();
    createFolderInput.value?.select();
  });
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

onUnmounted(() => {
  removeOnComplete(libraryId.value);
  removeOnSuccess(libraryId.value);
  if (uploadRefreshTimer) {
    clearTimeout(uploadRefreshTimer);
    uploadRefreshTimer = null;
  }
});

function handleRowClick(entry: LibraryEntry, event: MouseEvent) {
  event.preventDefault();
  const isShift = event.shiftKey;
  const isMultiSelect = event.ctrlKey || event.metaKey;

  const entryList = entries.value;
  const clickedIndex = entryList.findIndex((e) => e.id === entry.id && e.kind === entry.kind);
  if (clickedIndex === -1) return;

  if (isShift && lastClickedIndex.value !== null) {
    // Range-select from the fixed anchor to the clicked item across files and folders.
    // The anchor does NOT move on shift-click so further shift-clicks always extend
    // from the same origin.
    const anchor = lastClickedIndex.value;
    const start = Math.min(anchor, clickedIndex);
    const end = Math.max(anchor, clickedIndex);
    if (!isMultiSelect) {
      selectedFiles.clear();
      selectedFolders.clear();
    }
    for (let i = start; i <= end; i++) {
      const e = entryList[i]!;
      if (e.kind === "file") selectedFiles.add(e.id);
      else selectedFolders.add(e.id);
    }
  } else if (isMultiSelect) {
    if (entry.kind === "file") {
      if (selectedFiles.has(entry.id)) selectedFiles.delete(entry.id);
      else selectedFiles.add(entry.id);
    } else {
      if (selectedFolders.has(entry.id)) selectedFolders.delete(entry.id);
      else selectedFolders.add(entry.id);
    }
    lastClickedIndex.value = clickedIndex;
  } else {
    clearSelection();
    if (entry.kind === "file") selectedFiles.add(entry.id);
    else selectedFolders.add(entry.id);
    lastClickedIndex.value = clickedIndex;
  }
}

function downloadFiles(ids: string[]) {
  if (ids.length > 1) {
    startZipDownload(ids, []);
    return;
  }
  for (const fid of ids) {
    const link = document.createElement("a");
    link.href = `/api/libraries/${libraryId.value}/files/${fid}?inline=true`;
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
  try {
    if (purgeAll.value) {
      const result = await apiFetch<{ purged: number }>(
        `/api/libraries/${libraryId.value}/files/purge`,
        {
          method: "POST",
        },
      );
      entries.value = [];
      nextCursor.value = null;
      totalCount.value = 0;
      trashedCount.value = 0;
      toast.add({
        title: `${result.purged} ${result.purged === 1 ? "item" : "items"} permanently deleted`,
        color: "success",
      });
    } else {
      const result = await apiFetch<{ purged: number }>(
        `/api/libraries/${libraryId.value}/files/purge`,
        {
          method: "POST",
          body: foldersToPurge.value.length
            ? { folderIds: foldersToPurge.value }
            : { fileIds: filesToPurge.value },
        },
      );
      await resetAndFetch();
      await refreshTrashedCount();
      toast.add({
        title: `${result.purged} ${result.purged === 1 ? "item" : "items"} permanently deleted`,
        color: "success",
      });
    }
    purgeModalOpen.value = false;
    purgeConfirmation.value = "";
    filesToPurge.value = [];
    foldersToPurge.value = [];
    purgeAll.value = false;
  } catch (error) {
    console.error("Failed to permanently delete items:", error);
    toast.add({
      title: "Failed to permanently delete items",
      description: error instanceof Error ? error.message : "Unknown error",
      color: "error",
    });
  }
}

function getContextMenuItems(entry: LibraryEntry): ContextMenuItem[][] {
  // Determine the full selection. If the right-clicked item is part of the current
  // selection, act on everything selected; otherwise act only on the clicked item.
  const isInSelection =
    entry.kind === "file" ? selectedFiles.has(entry.id) : selectedFolders.has(entry.id);

  const targetFileIds: string[] = isInSelection ? [...selectedFiles] : entry.kind === "file" ? [entry.id] : [];
  const targetFolderIds: string[] = isInSelection ? [...selectedFolders] : entry.kind === "folder" ? [entry.id] : [];
  const totalCount = targetFileIds.length + targetFolderIds.length;
  const isMulti = totalCount > 1;

  // ── Trash view ──────────────────────────────────────────────────────────────
  if (showTrashed.value) {
    if (!canManageLibrary.value) return [];

    // Only files support restore/purge from a per-item menu for now; folders
    // use their own restore path. When multiple items are selected handle both.
    const restoreItems: ContextMenuItem[] = [];
    const purgeItems: ContextMenuItem[] = [];

    if (targetFileIds.length) {
      restoreItems.push({
        label: targetFileIds.length > 1 ? `Restore ${targetFileIds.length} files` : "Restore",
        icon: "i-lucide-undo-2",
        onSelect: () => restoreFiles(targetFileIds),
      });
      purgeItems.push({
        label:
          targetFileIds.length > 1
            ? `Permanently delete ${targetFileIds.length} files`
            : "Permanently delete",
        icon: "i-lucide-trash-2",
        color: "error" as const,
        onSelect: () => openPurgeModal(targetFileIds),
      });
    }
    if (targetFolderIds.length) {
      restoreItems.push({
        label:
          targetFolderIds.length > 1
            ? `Restore ${targetFolderIds.length} folders`
            : "Restore folder",
        icon: "i-lucide-undo-2",
        onSelect: () => restoreFolders(targetFolderIds),
      });
      purgeItems.push({
        label:
          targetFolderIds.length > 1
            ? `Permanently delete ${targetFolderIds.length} folders`
            : "Permanently delete folder",
        icon: "i-lucide-trash-2",
        color: "error" as const,
        onSelect: () => openPurgeFolderModal(targetFolderIds),
      });
    }

    return [...(restoreItems.length ? [restoreItems] : []), ...(purgeItems.length ? [purgeItems] : [])];
  }

  // ── Read-only viewer ─────────────────────────────────────────────────────────
  if (!canManageLibrary.value) {
    return [
      [
        ...(entry.kind === "folder" && !isMulti
          ? [{ label: "Open", icon: "i-lucide-folder-open", onSelect: () => openFolder(entry.id) }]
          : []),
        {
          label: totalCount > 1 ? `Download ${totalCount} items as ZIP` : entry.kind === "folder" ? "Download as ZIP" : "Download",
          icon: "i-lucide-download",
          onSelect: () => downloadSelection(targetFileIds, targetFolderIds),
        },
      ],
    ];
  }

  // ── Multi-selection (files + folders mixed, or multiple of one kind) ─────────
  if (isMulti) {
    const multiTagItems = libraryTags.value.length
      ? libraryTags.value.map((tag) => ({
          label: tag.name,
          icon: areAllFilesTagged(targetFileIds, tag.id) ? "i-lucide-check" : "i-lucide-tag",
          onSelect: () => toggleTagForFiles(targetFileIds, tag.id),
        }))
      : [{ label: "No tags yet", disabled: true }];

    return [
      [
        {
          label: `Download ${totalCount} items as ZIP`,
          icon: "i-lucide-download",
          onSelect: () => downloadSelection(targetFileIds, targetFolderIds),
        },
        ...(targetFileIds.length
          ? [{
              label: targetFileIds.length > 1 ? `Move ${targetFileIds.length} files` : "Move",
              icon: "i-lucide-folder-input",
              onSelect: () => openMoveFilesModal(targetFileIds),
            }]
          : []),
        {
          label: `Tags`,
          icon: "i-lucide-tags",
          children: multiTagItems,
        },
      ],
      [
        {
          label: `Delete ${totalCount} items`,
          icon: "i-lucide-trash-2",
          color: "error" as const,
          onSelect: () => {
            if (targetFileIds.length) void trashFiles(targetFileIds);
            if (targetFolderIds.length) void deleteFolders(targetFolderIds);
          },
        },
      ],
    ];
  }

  // ── Single folder ────────────────────────────────────────────────────────────
  if (entry.kind === "folder") {
    const folderTagItems = libraryTags.value.length
      ? libraryTags.value.map((tag) => ({
          label: tag.name,
          icon: isFolderTagAssigned(entry, tag.id) ? "i-lucide-check" : "i-lucide-tag",
          onSelect: () => toggleTagForFolder(entry, tag.id),
        }))
      : [{ label: "No tags yet", disabled: true }];

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

  // ── Single file ──────────────────────────────────────────────────────────────
  const tagItems = libraryTags.value.length
    ? libraryTags.value.map((tag) => ({
        label: tag.name,
        icon: areAllFilesTagged([entry.id], tag.id) ? "i-lucide-check" : "i-lucide-tag",
        onSelect: () => toggleTagForFiles([entry.id], tag.id),
      }))
    : [{ label: "No tags yet", disabled: true }];

  return [
    [
      {
        label: "Download",
        icon: "i-lucide-download",
        onSelect: () => downloadFiles([entry.id]),
      },
      {
        label: "Move",
        icon: "i-lucide-folder-input",
        onSelect: () => openMoveFilesModal([entry.id]),
      },
      {
        label: "Rename",
        icon: "i-lucide-pencil",
        onSelect: () => startEntryRename(entry),
      },
      ...(entry.kind === "file" && entry.mimeType.startsWith("video/")
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
        label: "Tags",
        icon: "i-lucide-tags",
        children: tagItems,
      },
    ],
    [
      {
        label: "Delete",
        icon: "i-lucide-trash-2",
        color: "error" as const,
        onSelect: () => trashFiles([entry.id]),
      },
    ],
  ];
}

const contextMenuGroups = computed(() =>
  contextMenuEntry.value ? getContextMenuItems(contextMenuEntry.value) : [],
);

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
  <div
    class="relative flex h-full flex-1 min-h-0 flex-col gap-4"
    v-bind="fileDropZoneProps"
  >
    <div
      v-if="isFileDragActive"
      class="absolute inset-0 z-30 rounded-lg border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center pointer-events-none"
    >
      <div class="badge badge-primary badge-lg px-4 py-3 text-sm font-medium">
        Drop files to upload to this folder
      </div>
    </div>

    <LibraryTabs
      :library-id="libraryId || ''"
      :face-recognition-enabled="library?.faceRecognitionEnabled"
      :can-manage-library="canManageLibrary"
    />

    <div class="flex min-h-10 w-full items-center gap-2 pl-2 sm:pl-3 lg:pl-4">
      <div v-if="!showTrashed" class="min-w-0 flex-1">
        <div class="breadcrumbs text-sm leading-tight">
          <ul class="whitespace-nowrap">
            <li v-for="(item, index) in breadcrumbItems" :key="item.id" class="min-w-0">
              <RouterLink
                v-if="!item.isCurrent"
                :to="item.to"
                class="inline-flex items-center gap-1 truncate max-w-32 sm:max-w-56 font-semibold text-base-content/70 transition-colors hover:text-primary"
              >
                <AppIcon v-if="index === 0" name="i-lucide-house" class="size-4 shrink-0" />
                {{ item.label }}
              </RouterLink>
              <span v-else class="inline-flex items-center gap-1 truncate max-w-32 sm:max-w-56 font-semibold text-base-content">
                <AppIcon v-if="index === 0" name="i-lucide-house" class="size-4 shrink-0" />
                {{ item.label }}
              </span>
            </li>
          </ul>
        </div>
      </div>
      <div v-else class="min-w-0 flex-1" />

      <div class="flex shrink-0 items-center gap-2">
        <template v-if="!showTrashed">
          <button
            class="btn btn-soft btn-square btn-sm min-h-8 h-8 w-8 p-0"
            :class="entryViewMode === 'file' ? 'btn-primary' : ''"
            title="List view"
            @click="entryViewMode = 'file'"
          >
            <AppIcon name="i-lucide-list" class="size-4" />
          </button>
          <button
            class="btn btn-soft btn-square btn-sm min-h-8 h-8 w-8 p-0"
            :class="entryViewMode === 'card' ? 'btn-primary' : ''"
            title="Grid view"
            @click="entryViewMode = 'card'"
          >
            <AppIcon name="i-lucide-layout-grid" class="size-4" />
          </button>
        </template>

        <button
          v-if="showTrashed && !filesPending && totalCount > 0"
          class="btn btn-soft btn-sm btn-error"
          @click="openPurgeAllModal()"
        >
          <AppIcon name="i-lucide-trash-2" class="size-4" />
          <span class="hidden sm:inline">Delete All</span>
        </button>

        <details
          v-if="canManageLibrary && !showTrashed"
          ref="newDropdown"
          class="dropdown dropdown-end relative z-20"
        >
          <summary class="btn btn-soft btn-sm btn-primary">
            <AppIcon name="i-lucide-plus" class="size-4" />
            <span class="hidden sm:inline">New</span>
          </summary>
          <ul class="dropdown-content menu bg-base-100 rounded-box z-50 w-52 p-2 shadow mt-2">
            <li v-for="group in newMenuItems" :key="group.map((i) => i.label).join()">
              <a
                v-for="item in group"
                :key="item.label"
                href="#"
                @click.prevent="
                  item.onSelect();
                  newDropdown!.open = false;
                "
              >
                <AppIcon :name="item.icon" class="size-4" />
                {{ item.label }}
              </a>
            </li>
          </ul>
        </details>
      </div>
    </div>

    <div class="relative overflow-y-auto flex-1 min-h-0">
      <div
        v-if="filesPending && (entries?.length ?? 0) === 0"
        class="flex min-h-64 items-center justify-center"
      >
        <div class="inline-flex items-center gap-2 rounded-box border border-base-300/70 bg-base-100 px-3 py-2 text-sm text-base-content/70 shadow-sm">
          <AppIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Loading {{ showTrashed ? "trash" : "files" }}
        </div>
      </div>

      <div
        v-if="filesPending && (entries?.length ?? 0) > 0"
        class="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-base-100/35 pt-6"
      >
        <div class="badge badge-soft badge-primary gap-2 px-3 py-3">
          <AppIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Loading
        </div>
      </div>

      <LibraryEntriesTable
        v-else-if="entryViewMode === 'file' && (entries?.length ?? 0) > 0"
        :entries="entries ?? []"
        :show-trashed="showTrashed"
        :drag-enabled="dragEnabled"
        :dragged-file-ids="draggedFileIds"
        :drop-target-folder-id="dropTargetFolderId"
        :rename-value="renameValue"
        :is-entry-selected="isEntrySelected"
        :is-renaming="isRenaming"
        @row-click="handleRowClick"
        @row-double-click="openEntry"
        @row-context-menu="showContextMenu"
        @drag-start="handleFileDragStart"
        @drag-end="handleFileDragEnd"
        @drag-enter="handleFolderDragEnter"
        @drag-over="handleFolderDragOver"
        @drag-leave="handleFolderDragLeave"
        @drop="handleFolderDrop"
        @save-rename="saveEntryRename"
        @cancel-rename="renamingEntry = null"
        @update-rename-value="renameValue = $event"
      />

      <LibraryEntriesGrid
        v-else-if="entryViewMode === 'card' && (entries?.length ?? 0) > 0"
        :entries="entries ?? []"
        :library-id="libraryId || ''"
        :show-trashed="showTrashed"
        :drag-enabled="dragEnabled"
        :dragged-file-ids="draggedFileIds"
        :drop-target-folder-id="dropTargetFolderId"
        :rename-value="renameValue"
        :is-entry-selected="isEntrySelected"
        :is-renaming="isRenaming"
        :failed-thumbnails="failedThumbnails"
        :is-image-file="isImageFile"
        :is-small-image="isSmallImage"
        :card-thumb-width="cardThumbWidth"
        :card-thumb-height="cardThumbHeight"
        @row-click="handleRowClick"
        @row-double-click="openEntry"
        @row-context-menu="showContextMenu"
        @drag-start="handleFileDragStart"
        @drag-end="handleFileDragEnd"
        @drag-enter="handleFolderDragEnter"
        @drag-over="handleFolderDragOver"
        @drag-leave="handleFolderDragLeave"
        @drop="handleFolderDrop"
        @save-rename="saveEntryRename"
        @cancel-rename="renamingEntry = null"
        @update-rename-value="renameValue = $event"
        @thumbnail-error="failedThumbnails.add($event)"
      />

      <LibraryEmptyState
        v-if="(entries?.length ?? 0) === 0 && !filesPending"
        :show-trashed="showTrashed"
        :title="emptyStateTitle"
        :description="emptyStateDescription"
        :can-manage-library="canManageLibrary"
        @create-folder="openCreateFolderModal"
        @upload-files="uploadOpen = true"
      />

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
              ref="createFolderInput"
              v-model="createFolderName"
              placeholder="New folder"
              class="input w-full"
              @keydown.enter="createFolder"
            />
          </fieldset>
        </div>
        <div class="modal-action">
          <button class="btn btn-soft btn-outline" @click="createFolderOpen = false">Cancel</button>
          <button
            class="btn btn-soft btn-primary"
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
            <select v-model="moveDestinationValue" class="select w-full" :disabled="moveLoading">
              <option v-for="item in moveDestinationOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </fieldset>
        </div>
        <div class="modal-action">
          <button class="btn btn-soft btn-outline" @click="moveFolderOpen = false">Cancel</button>
          <button
            class="btn btn-soft btn-primary"
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
          <button class="btn btn-soft btn-outline" @click="closeMoveFilesModal">Cancel</button>
          <button
            class="btn btn-soft btn-primary"
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
          <button class="btn btn-soft btn-outline" @click="purgeModalOpen = false">Cancel</button>
          <button
            class="btn btn-soft btn-error"
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
          <button class="btn btn-soft btn-outline" @click="cancelLargeDownload">Cancel</button>
          <button class="btn btn-soft btn-primary" :disabled="zipDownloading" @click="confirmLargeDownload">
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

    <AppContextMenu
      :open="!!contextMenuEntry && !!contextMenuPosition"
      :position="contextMenuPosition"
      @close="hideContextMenu"
    >
      <ul
        class="menu dropdown-content rounded-box bg-base-100 border border-base-300/70 shadow-xl p-2 w-auto max-h-[calc(100vh-1rem)] overflow-y-auto"
      >
        <ContextMenuItemsRenderer :groups="contextMenuGroups" @select="handleContextMenuSelect" />
      </ul>
    </AppContextMenu>
  </div>
</template>
