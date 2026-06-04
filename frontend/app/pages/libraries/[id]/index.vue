<script setup lang="ts">
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";
import { getMimeIcon, formatFileSize, formatDate } from "~/utils/mime-icons";

definePageMeta({ layout: "library", alias: ["/libraries/:id/trash"] });

import { api } from "~/api";
import { useLibraryExplorer } from "~/composables/useLibraryExplorer";
import { useLibraryFolderPath } from "~/composables/useLibraryFolderPath";
import { useLibraryTags } from "~/composables/useLibraryTags";
import { useDownloadZip } from "~/composables/useDownloadZip";
import { useLibraryFolderActions } from "~/composables/useLibraryFolderActions";
import { useUploadQueue } from "~/composables/useUploadQueue";
import { useFileDrop } from "~/composables/useFileDrop";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";
import type { ContextMenuItem as UIContextMenuItem } from "@nuxt/ui";
import UploadModal from "~/components/UploadModal.vue";
import FilePreview from "~/components/FilePreview.vue";
import AlcovesImage from "~/components/AlcovesImage.vue";
import LibraryEntriesGrid from "~/components/library/LibraryEntriesGrid.vue";
import LibraryEmptyState from "~/components/library/LibraryEmptyState.vue";
import LibraryEntriesTable from "~/components/library/LibraryEntriesTable.vue";

const ENTRY_VIEW_STORAGE_KEY = "alcoves.library.entry-view";
const ROOT_MOVE_VALUE = "__root__";

const toast = useToast();
const router = useRouter();

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

// Updated before UContextMenu opens on native contextmenu bubble.
function showContextMenu(entry: LibraryEntry, _event: MouseEvent) {
  contextMenuEntry.value = entry;
}

// Publish the current folder ancestry to the shared store so the library
// header (rendered by the parent layout) renders it in the breadcrumb heading.
// Empty in trash; cleared on unmount so non-Files tabs fall back to the name.
const folderPath = useLibraryFolderPath();
watchEffect(() => {
  folderPath.value = showTrashed.value ? [] : breadcrumbs.value;
});
onUnmounted(() => {
  folderPath.value = [];
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

// Build UDropdownMenu items for the "New" menu
const newDropdownMenuItems = computed(() =>
  newMenuItems.value.map((group) =>
    group.map((item) => ({
      label: item.label,
      icon: item.icon,
      onSelect: item.onSelect,
    })),
  ),
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
      const updated = await api.folders.update(libraryId.value, entry.id, { name: rawName });
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
    await api.files.update(libraryId.value, entry.id, { name: nextName });
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
      api.files.update(libraryId.value, fileId, { parentFolderId: targetFolderId }),
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
const {
  addFiles,
  onLibraryUploadComplete,
  removeOnComplete,
  onLibraryUploadSuccess,
  removeOnSuccess,
} = useUploadQueue();

const UPLOAD_REFRESH_DEBOUNCE_MS = 3_000;
const lastUploadRefreshAt = ref(0);
let uploadRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function refreshAfterUploadDebounced() {
  const now = Date.now();
  const elapsed = now - lastUploadRefreshAt.value;

  if (elapsed >= UPLOAD_REFRESH_DEBOUNCE_MS && !uploadRefreshTimer) {
    lastUploadRefreshAt.value = now;
    void resetAndFetch({ silent: true });
    return;
  }

  if (uploadRefreshTimer) return;

  uploadRefreshTimer = setTimeout(
    () => {
      uploadRefreshTimer = null;
      lastUploadRefreshAt.value = Date.now();
      void resetAndFetch({ silent: true });
    },
    Math.max(UPLOAD_REFRESH_DEBOUNCE_MS - elapsed, 0),
  );
}

const canDropUpload = computed(
  () => canManageLibrary.value && !showTrashed.value && draggedFileIds.value.length === 0,
);

const { isOverDropZone: isFileDragActive, dropZoneProps: fileDropZoneProps } = useFileDrop({
  enabled: canDropUpload,
  onDrop(droppedFiles) {
    addFiles(
      droppedFiles,
      libraryId.value,
      library.value?.name ?? "Library",
      currentFolderId.value,
    );
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
    link.href = apiUrl(`/api/libraries/${libraryId.value}/files/${fid}?inline=true`);
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

// Surfaces the {enqueued, skipped} response from bulk-transcribe /
// bulk-audio-detect as a single toast. Distinct from per-file toasts so
// users running on dozens of files don't get a wall of notifications.
async function runBulkAction(
  kind: "transcribe" | "audio-detect",
  fileIds: string[] | undefined,
) {
  const verb = kind === "transcribe" ? "Transcribe" : "Audio detection";
  const apiCall =
    kind === "transcribe"
      ? api.files.bulkTranscribe(libraryId.value, fileIds)
      : api.files.bulkAudioDetect(libraryId.value, fileIds);
  try {
    const res = await apiCall;
    const skippedCount = Object.keys(res.skipped).length;
    if (res.enqueued.length === 0) {
      toast.add({
        title: `${verb}: nothing to queue`,
        description: skippedCount ? `${skippedCount} file(s) skipped.` : undefined,
        color: "warning",
      });
      return;
    }
    toast.add({
      title: `${verb}: queued ${res.enqueued.length} file(s)`,
      description: skippedCount ? `Skipped ${skippedCount}` : undefined,
      color: "success",
    });
  } catch (e) {
    toast.add({
      title: `${verb} failed`,
      description: e instanceof Error ? e.message : "Unknown error",
      color: "error",
    });
  }
}

async function trashFiles(ids: string[]) {
  await api.files.delete(libraryId.value, ids[0]!, { fileIds: ids });
  ids.forEach((id) => selectedFiles.delete(id));
  entries.value = entries.value.filter(
    (entry) => !(entry.kind === "file" && ids.includes(entry.id)),
  );
  totalCount.value -= ids.length;
  trashedCount.value += ids.length;
}

async function restoreFiles(ids: string[]) {
  await api.files.restore(libraryId.value, { fileIds: ids });
  ids.forEach((id) => selectedFiles.delete(id));
  entries.value = entries.value.filter(
    (entry) => !(entry.kind === "file" && ids.includes(entry.id)),
  );
  totalCount.value -= ids.length;
  trashedCount.value -= ids.length;
}

async function restoreFolders(ids: string[]) {
  await api.folders.restore(libraryId.value, { folderIds: ids });
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
      const result = await api.files.purge(libraryId.value);
      entries.value = [];
      nextCursor.value = null;
      totalCount.value = 0;
      trashedCount.value = 0;
      toast.add({
        title: `${result.purged} ${result.purged === 1 ? "item" : "items"} permanently deleted`,
        color: "success",
      });
    } else {
      const result = await api.files.purge(
        libraryId.value,
        foldersToPurge.value.length
          ? { folderIds: foldersToPurge.value }
          : { fileIds: filesToPurge.value },
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

  const targetFileIds: string[] = isInSelection
    ? [...selectedFiles]
    : entry.kind === "file"
      ? [entry.id]
      : [];
  const targetFolderIds: string[] = isInSelection
    ? [...selectedFolders]
    : entry.kind === "folder"
      ? [entry.id]
      : [];
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

    return [
      ...(restoreItems.length ? [restoreItems] : []),
      ...(purgeItems.length ? [purgeItems] : []),
    ];
  }

  // ── Read-only viewer ─────────────────────────────────────────────────────────
  if (!canManageLibrary.value) {
    return [
      [
        ...(entry.kind === "folder" && !isMulti
          ? [{ label: "Open", icon: "i-lucide-folder-open", onSelect: () => openFolder(entry.id) }]
          : []),
        {
          label:
            totalCount > 1
              ? `Download ${totalCount} items as ZIP`
              : entry.kind === "folder"
                ? "Download as ZIP"
                : "Download",
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
          ? [
              {
                label: targetFileIds.length > 1 ? `Move ${targetFileIds.length} files` : "Move",
                icon: "i-lucide-folder-input",
                onSelect: () => openMoveFilesModal(targetFileIds),
              },
              {
                label: `Transcribe ${targetFileIds.length} file(s)`,
                icon: "i-lucide-captions",
                onSelect: () => runBulkAction("transcribe", targetFileIds),
              },
              {
                label: `Detect audio in ${targetFileIds.length} file(s)`,
                icon: "i-lucide-audio-waveform",
                onSelect: () => runBulkAction("audio-detect", targetFileIds),
              },
            ]
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
              label: "Editor",
              icon: "i-lucide-video",
              onSelect: () =>
                router.push({
                  path: `/libraries/${libraryId.value}/edit/${entry.id}`,
                  // Carry the originating folder so the editor's back
                  // button returns the user to where they were
                  // browsing instead of the library root.
                  query: currentFolderId.value ? { from: currentFolderId.value } : {},
                }),
            },
          ]
        : []),
      ...(entry.kind === "file" &&
      (entry.mimeType.startsWith("video/") || entry.mimeType.startsWith("audio/"))
        ? [
            {
              label: "Transcribe",
              icon: "i-lucide-captions",
              onSelect: () => runBulkAction("transcribe", [entry.id]),
            },
            {
              label: "Detect audio",
              icon: "i-lucide-audio-waveform",
              onSelect: () => runBulkAction("audio-detect", [entry.id]),
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

const contextMenuGroups = computed<UIContextMenuItem[][]>(() =>
  contextMenuEntry.value
    ? (getContextMenuItems(contextMenuEntry.value) as UIContextMenuItem[][])
    : [],
);

const { refreshLibraries } = useLibrariesList();

watch(library, () => {
  refreshLibraries();
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
  <div class="relative flex h-full flex-1 min-h-0 flex-col gap-4" v-bind="fileDropZoneProps">
    <div
      v-if="isFileDragActive"
      class="absolute inset-0 z-30 rounded-xl border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center pointer-events-none"
    >
      <UBadge
        color="primary"
        variant="solid"
        size="lg"
        icon="i-lucide-upload-cloud"
        class="px-4 py-3 text-sm font-medium shadow-lg"
      >
        Drop files to upload to this folder
      </UBadge>
    </div>

    <div class="flex min-h-10 w-full items-center justify-end gap-2">
      <div class="flex shrink-0 items-center gap-2">
        <template v-if="!showTrashed">
          <UTooltip text="List view">
            <UButton
              :color="entryViewMode === 'file' ? 'primary' : 'neutral'"
              variant="soft"
              size="sm"
              square
              icon="i-lucide-list"
              @click="entryViewMode = 'file'"
            />
          </UTooltip>
          <UTooltip text="Grid view">
            <UButton
              :color="entryViewMode === 'card' ? 'primary' : 'neutral'"
              variant="soft"
              size="sm"
              square
              icon="i-lucide-layout-grid"
              @click="entryViewMode = 'card'"
            />
          </UTooltip>
        </template>

        <UButton
          v-if="showTrashed && !filesPending && totalCount > 0"
          color="error"
          variant="soft"
          size="sm"
          icon="i-lucide-trash-2"
          @click="openPurgeAllModal()"
        >
          <span class="hidden sm:inline">Delete All</span>
        </UButton>

        <UDropdownMenu
          v-if="canManageLibrary && !showTrashed"
          :items="newDropdownMenuItems"
          :content="{ align: 'end' }"
        >
          <UButton color="primary" variant="soft" size="sm" icon="i-lucide-plus">
            <span class="hidden sm:inline">New</span>
          </UButton>
        </UDropdownMenu>
      </div>
    </div>

    <div class="relative overflow-y-auto flex-1 min-h-0 px-0.5">
      <UContextMenu :items="contextMenuGroups" :ui="{ content: 'w-56' }">
        <div
          v-if="filesPending && (entries?.length ?? 0) === 0"
          class="flex min-h-64 items-center justify-center"
        >
          <div
            class="inline-flex items-center gap-2 rounded-xl border border-default bg-elevated/70 px-3 py-2 text-sm text-muted shadow-sm"
          >
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
            Loading {{ showTrashed ? "trash" : "files" }}
          </div>
        </div>

        <div
          v-if="filesPending && (entries?.length ?? 0) > 0"
          class="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-default/35 pt-6"
        >
          <UBadge
            color="primary"
            variant="soft"
            size="md"
            class="gap-2 px-3 py-3"
            icon="i-lucide-loader-2"
            :ui="{ leadingIcon: 'animate-spin' }"
          >
            Loading
          </UBadge>
        </div>

        <LibraryEntriesTable
          v-if="entryViewMode === 'file' && (entries?.length ?? 0) > 0"
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
          <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
        </div>
      </UContextMenu>
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

    <!-- Create Folder Modal -->
    <UModal v-model:open="createFolderOpen" title="Create Folder">
      <template #body>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Folder name</label>
          <UInput
            ref="createFolderInput"
            v-model="createFolderName"
            placeholder="New folder"
            :ui="{ root: 'w-full' }"
            @keydown.enter="createFolder"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="outline" @click="createFolderOpen = false">
            Cancel
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-folder-plus"
            :loading="creatingFolder"
            :disabled="!createFolderName.trim() || creatingFolder"
            @click="createFolder"
          >
            Create
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Move Folder Modal -->
    <UModal v-model:open="moveFolderOpen" title="Move Folder">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            Move
            <strong>{{ movingFolder?.name }}</strong>
            to a new location.
          </p>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Destination</label>
            <USelect
              v-model="moveDestinationValue"
              :items="moveDestinationOptions"
              :disabled="moveLoading"
              class="w-full"
            />
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="outline" @click="moveFolderOpen = false">
            Cancel
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-folder-input"
            :loading="moveFolderSaving"
            :disabled="moveLoading || moveFolderSaving"
            @click="moveFolder"
          >
            Move
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Move Files Modal -->
    <UModal v-model:open="moveFilesOpen" title="Move Files">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            Move
            <strong>{{ moveFileCount }}</strong>
            {{ moveFileCount === 1 ? "file" : "files" }} to a new location.
          </p>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Destination</label>
            <USelect
              v-model="moveFilesDestinationValue"
              :items="moveFileDestinationOptions"
              :disabled="moveFilesLoading"
              class="w-full"
            />
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="outline" @click="closeMoveFilesModal"> Cancel </UButton>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-folder-input"
            :loading="moveFilesSaving"
            :disabled="moveFilesLoading || moveFilesSaving"
            @click="moveFiles"
          >
            Move
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Permanently Delete Items Modal -->
    <UModal v-model:open="purgeModalOpen" title="Permanently Delete Items">
      <template #body>
        <div class="flex flex-col gap-4">
          <UAlert
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            :title="`Delete ${purgeFileCount} ${purgeFileCount === 1 ? 'item' : 'items'}`"
            description="This will permanently delete these items from disk. This action cannot be undone."
          />
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Type 'delete' to confirm</label>
            <UInput v-model="purgeConfirmation" placeholder="delete" :ui="{ root: 'w-full' }" />
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="outline" @click="purgeModalOpen = false">
            Cancel
          </UButton>
          <UButton
            color="error"
            variant="soft"
            icon="i-lucide-trash-2"
            :disabled="purgeConfirmation !== 'delete'"
            @click="handlePermanentDelete"
          >
            Delete Permanently
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Large Download Warning Modal -->
    <UModal v-model:open="showSizeWarning" title="Large Download Warning">
      <template #body>
        <div class="flex flex-col gap-3">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-alert-triangle"
            description="This download is very large and may take a while."
          />
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-xl border border-default bg-elevated/50 p-3">
              <p class="text-muted text-xs uppercase tracking-wide">Estimated Size</p>
              <p class="font-medium text-default mt-1">{{ formattedEstimatedSize }}</p>
            </div>
            <div class="rounded-xl border border-default bg-elevated/50 p-3">
              <p class="text-muted text-xs uppercase tracking-wide">Files</p>
              <p class="font-medium text-default mt-1">
                {{ estimatedFileCount.toLocaleString("en-US") }}
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="outline" @click="cancelLargeDownload"> Cancel </UButton>
          <UButton
            color="primary"
            variant="soft"
            icon="i-lucide-download"
            :loading="zipDownloading"
            :disabled="zipDownloading"
            @click="confirmLargeDownload"
          >
            Download Anyway
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
