<script setup lang="ts">
import type { ContextMenuItem, DropdownMenuItem, BreadcrumbItem } from "@nuxt/ui";
import type {
  FolderBreadcrumb,
  Library,
  LibraryEntry,
  LibraryFile,
  LibraryFolder,
  LibraryTag,
  PaginatedFiles,
} from "~~/server/utils/types";
import { isTagColorInPalette, TAG_COLOR_PALETTE } from "~~/shared/tag-colors";
import { getMimeIcon, formatFileSize, formatDate } from "~/utils/mime-icons";

definePageMeta({
  layout: "dashboard",
});

const ROOT_MOVE_VALUE = "__root__";

const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const toast = useToast();

const { user } = useAuth();

const { data: library, refresh: refreshLibrary } = await useFetch<Library>(
  () => `/api/libraries/${libraryId.value}`,
);

const viewMode = ref<"files" | "tags" | "trash">("files");
const showTrashed = computed(() => viewMode.value === "trash");
const showTags = computed(() => viewMode.value === "tags");
const currentFolderId = computed(() => {
  const raw = route.query.folder;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value || null;
});

function buildFolderQuery(folderId: string | null) {
  const query = { ...route.query };
  delete query.folder;
  if (folderId) {
    query.folder = folderId;
  }
  return query;
}

function openFolder(folderId: string | null) {
  return navigateTo({
    path: route.path,
    query: buildFolderQuery(folderId),
  });
}

// Paginated entry state
const ssrHeaders = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;
const { data: _init } = await useAsyncData(
  `library-init-${libraryId.value}-${currentFolderId.value ?? "root"}`,
  async () => {
    const filesQuery: Record<string, string> = {};
    if (currentFolderId.value) filesQuery.folder = currentFolderId.value;

    const [result, trashedResult, tags] = await Promise.all([
      $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
        query: filesQuery,
        headers: ssrHeaders,
      }),
      $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
        query: { trashed: "true", limit: "1" },
        headers: ssrHeaders,
      }),
      $fetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`, {
        headers: ssrHeaders,
      }),
    ]);
    return { result, trashedCount: trashedResult.totalCount, tags };
  },
  { watch: [libraryId, currentFolderId] },
);

const entries = ref<LibraryEntry[]>(_init.value?.result.entries ?? []);
const breadcrumbs = ref<FolderBreadcrumb[]>(_init.value?.result.breadcrumbs ?? []);
const nextCursor = ref<string | null>(_init.value?.result.nextCursor ?? null);
const totalCount = ref(_init.value?.result.totalCount ?? 0);
const trashedCount = ref(_init.value?.trashedCount ?? 0);
const libraryTags = ref<LibraryTag[]>(_init.value?.tags ?? []);
const loadingMore = ref(false);
const filesPending = ref(!_init.value);

const files = computed(() =>
  entries.value.filter((entry): entry is LibraryFile => entry.kind === "file"),
);

const selected = reactive(new Set<string>());

async function fetchPage(cursor?: string): Promise<PaginatedFiles> {
  const query: Record<string, string> = {};
  if (showTrashed.value) {
    query.trashed = "true";
  } else if (currentFolderId.value) {
    query.folder = currentFolderId.value;
  }
  if (cursor) query.cursor = cursor;
  return $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, { query });
}

async function loadMore() {
  if (loadingMore.value || !nextCursor.value) return;
  loadingMore.value = true;
  try {
    const result = await fetchPage(nextCursor.value);
    entries.value.push(...result.entries);
    nextCursor.value = result.nextCursor;
    totalCount.value = result.totalCount;
    breadcrumbs.value = result.breadcrumbs;
  } finally {
    loadingMore.value = false;
  }
}

async function resetAndFetch() {
  filesPending.value = true;
  entries.value = [];
  nextCursor.value = null;
  selected.clear();
  try {
    const result = await fetchPage();
    entries.value = result.entries;
    breadcrumbs.value = result.breadcrumbs;
    nextCursor.value = result.nextCursor;
    totalCount.value = result.totalCount;
    if (showTrashed.value) {
      trashedCount.value = result.totalCount;
    }
  } finally {
    filesPending.value = false;
  }
}

async function refreshTags() {
  libraryTags.value = await $fetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`);
}

async function refreshTrashedCount() {
  const result = await $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
    query: { trashed: "true", limit: "1" },
  });
  trashedCount.value = result.totalCount;
}

async function refreshFolders(): Promise<LibraryFolder[]> {
  return $fetch<LibraryFolder[]>(`/api/libraries/${libraryId.value}/folders`);
}

function getFileTagIds(file: LibraryFile): string[] {
  return file.tags.map((tag) => tag.id);
}

watchEffect(() => {
  if (!_init.value) return;
  entries.value = _init.value.result.entries;
  breadcrumbs.value = _init.value.result.breadcrumbs;
  nextCursor.value = _init.value.result.nextCursor;
  totalCount.value = _init.value.result.totalCount;
  trashedCount.value = _init.value.trashedCount;
  libraryTags.value = _init.value.tags;
  filesPending.value = false;
});

const lastClickedIndex = ref<number | null>(null);
const editingName = ref(false);
const editName = ref("");
const renamingEntry = ref<LibraryEntry | null>(null);
const renameValue = ref("");
const uploadOpen = ref(false);
const createTagName = ref("");
const creatingTag = ref(false);
const tagDraftNames = reactive<Record<string, string>>({});

// Create folder modal state
const createFolderOpen = ref(false);
const createFolderName = ref("");
const creatingFolder = ref(false);

// Move folder modal state
const moveFolderOpen = ref(false);
const movingFolder = ref<LibraryFolder | null>(null);
const moveDestinationValue = ref<string>(ROOT_MOVE_VALUE);
const moveLoading = ref(false);
const moveFolderSaving = ref(false);
const allFolders = ref<LibraryFolder[]>([]);

// File preview state
const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);

const breadcrumbItems = computed<BreadcrumbItem[]>(() => {
  if (showTrashed.value || showTags.value) return [];

  return [
    {
      label: "Root",
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
      onSelect() {
        createFolderName.value = "";
        createFolderOpen.value = true;
      },
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
  if (showTrashed.value || showTags.value) return;
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
      const updated = await $fetch<LibraryFolder>(
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
    await $fetch(`/api/libraries/${libraryId.value}/files/${entry.id}`, {
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

async function createFolder() {
  const name = createFolderName.value.trim();
  if (!name) return;

  creatingFolder.value = true;
  try {
    await $fetch<LibraryFolder>(`/api/libraries/${libraryId.value}/folders`, {
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

    await $fetch(`/api/libraries/${libraryId.value}/folders/${movingFolder.value.id}/move`, {
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

async function deleteFolder(folder: LibraryFolder) {
  try {
    await $fetch(`/api/libraries/${libraryId.value}/folders/${folder.id}`, {
      method: "DELETE",
    });
    await Promise.all([resetAndFetch(), refreshTrashedCount()]);
  } catch {
    toast.add({ title: "Failed to delete folder", color: "error" });
  }
}

function openEntry(entry: LibraryEntry) {
  if (entry.kind === "folder") {
    openFolder(entry.id);
    return;
  }

  openPreview(entry);
}

// Library delete state
const deleteLibraryOpen = ref(false);
const deleteLibraryConfirmation = ref("");

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
  if (showTags.value) {
    refreshTags().catch(() => {
      toast.add({ title: "Failed to load tags", color: "error" });
    });
  }
  if (userToggledView.value && !showTags.value) {
    userToggledView.value = false;
    resetAndFetch();
  }
});

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

// Infinite scroll observer
const sentinel = ref<HTMLElement | null>(null);

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
  editName.value = library.value?.name ?? "";
  editingName.value = true;
}

async function saveLibraryName() {
  editingName.value = false;
  if (!editName.value.trim() || editName.value === library.value?.name) return;
  await $fetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { name: editName.value.trim() },
  });
  await refreshLibrary();
}

function handleRowClick(entry: LibraryEntry, event: MouseEvent) {
  event.preventDefault();

  if (entry.kind === "folder") {
    selected.clear();
    lastClickedIndex.value = null;
    return;
  }

  const fileList = files.value;
  const clickedIndex = fileList.findIndex((f) => f.id === entry.id);

  if (event.shiftKey && lastClickedIndex.value !== null) {
    const start = Math.min(lastClickedIndex.value, clickedIndex);
    const end = Math.max(lastClickedIndex.value, clickedIndex);
    if (!(event.ctrlKey || event.metaKey)) {
      selected.clear();
    }
    for (let i = start; i <= end; i++) {
      selected.add(fileList[i]!.id);
    }
  } else if (event.ctrlKey || event.metaKey) {
    if (selected.has(entry.id)) {
      selected.delete(entry.id);
    } else {
      selected.add(entry.id);
    }
    lastClickedIndex.value = clickedIndex;
  } else {
    selected.clear();
    selected.add(entry.id);
    lastClickedIndex.value = clickedIndex;
  }
}

function downloadFiles(ids: string[]) {
  for (const fid of ids) {
    const link = document.createElement("a");
    link.href = `/api/libraries/${libraryId.value}/files/${fid}`;
    link.download = "";
    link.click();
  }
}

async function trashFiles(ids: string[]) {
  await $fetch(`/api/libraries/${libraryId.value}/files/${ids[0]}`, {
    method: "DELETE",
    body: { fileIds: ids },
  });
  ids.forEach((id) => selected.delete(id));
  entries.value = entries.value.filter(
    (entry) => !(entry.kind === "file" && ids.includes(entry.id)),
  );
  totalCount.value -= ids.length;
  trashedCount.value += ids.length;
}

async function restoreFiles(ids: string[]) {
  await $fetch(`/api/libraries/${libraryId.value}/files/restore`, {
    method: "POST",
    body: { fileIds: ids },
  });
  ids.forEach((id) => selected.delete(id));
  entries.value = entries.value.filter(
    (entry) => !(entry.kind === "file" && ids.includes(entry.id)),
  );
  totalCount.value -= ids.length;
  trashedCount.value -= ids.length;
}

async function restoreFolders(ids: string[]) {
  await $fetch(`/api/libraries/${libraryId.value}/folders/restore`, {
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
    await $fetch(`/api/libraries/${libraryId.value}/files/purge`, {
      method: "POST",
      body: { all: true },
    });
    entries.value = [];
    nextCursor.value = null;
    totalCount.value = 0;
    trashedCount.value = 0;
  } else {
    await $fetch(`/api/libraries/${libraryId.value}/files/purge`, {
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
    if (showTags.value) return [];

    if (showTrashed.value) {
      return [
        [
          {
            label: "Restore folder",
            icon: "i-lucide-undo-2",
            onSelect: () => restoreFolders([entry.id]),
          },
        ],
        [
          {
            label: "Permanently delete folder",
            icon: "i-lucide-trash-2",
            color: "error" as const,
            onSelect: () => openPurgeFolderModal([entry.id]),
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

  const targetIds = selected.has(entry.id) ? [...selected] : [entry.id];
  const count = targetIds.length;

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
        label: "Download",
        icon: "i-lucide-download",
        onSelect: () => downloadFiles(targetIds),
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

async function saveFileTags(file: LibraryFile, tagIds: string[]) {
  const result = await $fetch<{ tags: LibraryTag[] }>(
    `/api/libraries/${libraryId.value}/files/${file.id}/tags`,
    {
      method: "PUT",
      body: { tagIds },
    },
  );
  file.tags = result.tags;
}

async function saveFolderTags(folder: LibraryFolder, tagIds: string[]) {
  const result = await $fetch<{ tags: LibraryTag[] }>(
    `/api/libraries/${libraryId.value}/folders/${folder.id}/tags`,
    {
      method: "PUT",
      body: { tagIds },
    },
  );
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
        const nextTagIds = new Set(getFileTagIds(file));
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

async function createTag() {
  const name = createTagName.value.trim();
  if (!name) return;
  creatingTag.value = true;
  try {
    const tag = await $fetch<LibraryTag>(`/api/libraries/${libraryId.value}/tags`, {
      method: "POST",
      body: { name },
    });
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
    const updated = await $fetch<LibraryTag>(`/api/libraries/${libraryId.value}/tags/${tag.id}`, {
      method: "PATCH",
      body: { color: normalized },
    });
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
  if (isTagColorUsedByAnotherTag(tag.id, color)) return;
  updateTagColor(tag, color);
}

async function renameTag(tag: LibraryTag, nextName: string) {
  const name = nextName.trim();
  if (!name || name === tag.name) return;
  try {
    const updated = await $fetch<LibraryTag>(`/api/libraries/${libraryId.value}/tags/${tag.id}`, {
      method: "PATCH",
      body: { name },
    });
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
    await $fetch(`/api/libraries/${libraryId.value}/tags/${tagId}`, { method: "DELETE" });
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

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const canDeleteLibrary = computed(() => {
  if (!library.value || !user.value) return false;
  if (library.value.isDefault) return false;
  if (library.value.ownerId !== user.value.id) return false;
  if (showTrashed.value || showTags.value) return false;
  if (currentFolderId.value) return false;
  if (totalCount.value > 0 || trashedCount.value > 0) return false;
  return true;
});

async function deleteLibrary() {
  await $fetch(`/api/libraries/${libraryId.value}`, { method: "DELETE" });
  deleteLibraryOpen.value = false;
  await refreshLibraries?.();
  await navigateTo("/");
}

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
    <div class="flex items-center justify-between h-10">
      <div class="flex items-center gap-2">
        <h1
          v-if="!editingName"
          class="text-xl font-semibold cursor-pointer hover:text-primary"
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
      <div class="flex items-center gap-2">
        <UButton
          v-if="showTrashed && !filesPending && totalCount > 0"
          label="Permanently Delete All"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          @click="openPurgeAllModal()"
        />
        <UButton
          v-if="canDeleteLibrary"
          label="Delete Library"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          @click="deleteLibraryOpen = true"
        />
        <template v-if="!showTrashed && !showTags">
          <UDropdownMenu :items="newMenuItems">
            <UButton icon="i-lucide-plus" label="New" color="neutral" variant="outline" />
          </UDropdownMenu>
          <UButton icon="i-lucide-upload" label="Upload" @click="uploadOpen = true" />
        </template>
      </div>
    </div>

    <UBreadcrumb v-if="!showTrashed && !showTags" :items="breadcrumbItems" />

    <div class="flex items-center gap-1">
      <UButton
        label="Files"
        icon="i-lucide-folder"
        :variant="!showTrashed && !showTags ? 'soft' : 'ghost'"
        :color="!showTrashed && !showTags ? 'primary' : 'neutral'"
        size="sm"
        @click="
          userToggledView = true;
          viewMode = 'files';
        "
      />
      <UButton
        label="Tags"
        icon="i-lucide-tags"
        :variant="showTags ? 'soft' : 'ghost'"
        :color="showTags ? 'primary' : 'neutral'"
        size="sm"
        @click="
          userToggledView = true;
          viewMode = 'tags';
        "
      />
      <UButton
        label="Trash"
        icon="i-lucide-trash-2"
        :variant="showTrashed ? 'soft' : 'ghost'"
        :color="showTrashed ? 'primary' : 'neutral'"
        size="sm"
        @click="
          userToggledView = true;
          viewMode = 'trash';
        "
      />
    </div>

    <div v-if="showTags" class="grid gap-4">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-semibold">Create Tag</p>
              <p class="text-xs text-muted">Add labels to organize files and folders.</p>
            </div>
            <UBadge
              color="neutral"
              variant="soft"
              :label="`${libraryTags.length} ${libraryTags.length === 1 ? 'tag' : 'tags'}`"
            />
          </div>
        </template>

        <div class="flex flex-col sm:flex-row sm:items-end gap-2">
          <UFormField label="Tag name" class="flex-1">
            <UInput
              v-model="createTagName"
              placeholder="Design docs"
              icon="i-lucide-tag"
              class="w-full"
              @keydown.enter="createTag"
            />
          </UFormField>
          <UButton
            label="Create Tag"
            icon="i-lucide-plus"
            :loading="creatingTag"
            :disabled="!createTagName.trim()"
            @click="createTag"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-semibold">Manage Tags</p>
            <p class="text-xs text-muted">Click a color dot to open the palette.</p>
          </div>
        </template>

        <div
          v-if="libraryTags.length"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <div
            v-for="tag in libraryTags"
            :key="tag.id"
            class="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-3 bg-(--ui-bg)/40"
          >
            <UPopover>
              <button
                type="button"
                class="size-8 rounded-full border-2 border-default cursor-pointer shadow-sm"
                :style="{ backgroundColor: tag.color }"
                :title="`Tag color: ${tag.color}`"
              />
              <template #content>
                <div class="p-2 w-[12rem] sm:w-[16rem] lg:w-[21rem]">
                  <div class="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1">
                    <button
                      v-for="color in getTagColorChoices(tag)"
                      :key="`${tag.id}-${color}`"
                      type="button"
                      class="size-5 rounded-full border transition-transform disabled:opacity-35 disabled:cursor-not-allowed"
                      :class="
                        color === tag.color.toUpperCase()
                          ? 'border-primary ring-2 ring-primary/30 scale-110'
                          : 'border-default hover:scale-105'
                      "
                      :style="{ backgroundColor: color }"
                      :title="isTagColorUsedByAnotherTag(tag.id, color) ? `${color} (used)` : color"
                      :disabled="isTagColorUsedByAnotherTag(tag.id, color)"
                      @click="selectTagColor(tag, color)"
                    />
                  </div>
                </div>
              </template>
            </UPopover>

            <div class="min-w-0 flex-1 flex items-center gap-2">
              <UInput
                v-model="tagDraftNames[tag.id]"
                class="flex-1"
                @blur="saveDraftTagName(tag)"
                @keydown.enter="saveDraftTagName(tag)"
              />
              <UBadge color="neutral" variant="outline" :label="tag.color" class="shrink-0" />
            </div>

            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="soft"
              size="sm"
              class="self-start sm:self-auto"
              @click="deleteTag(tag.id)"
            />
          </div>
        </div>

        <div v-else class="rounded-lg border border-dashed border-default p-8 text-center">
          <UIcon name="i-lucide-tags" class="size-8 text-muted mx-auto mb-2" />
          <p class="text-sm font-medium">No tags yet</p>
          <p class="text-xs text-muted mt-1">Create your first tag to start organizing content.</p>
        </div>
      </UCard>
    </div>

    <div v-else class="border border-default rounded-lg overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-default bg-elevated/50">
            <th class="w-10 px-3 py-2" />
            <th class="text-left text-xs font-medium text-muted px-3 py-2">Name</th>
            <th class="text-left text-xs font-medium text-muted px-3 py-2">Tags</th>
            <th class="text-left text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">
              {{ showTrashed ? "Trashed" : "Modified" }}
            </th>
            <th class="text-right text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">
              Size
            </th>
          </tr>
        </thead>
        <tbody class="select-none">
          <template v-for="entry in entries" :key="`${entry.kind}-${entry.id}`">
            <UContextMenu :items="getContextMenuItems(entry)">
              <tr
                class="border-b border-default last:border-b-0 cursor-pointer transition-colors"
                :class="selected.has(entry.id) ? 'bg-primary/10' : 'hover:bg-elevated/50'"
                @click="handleRowClick(entry, $event)"
                @dblclick="openEntry(entry)"
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
                      @click.stop="startEntryRename(entry)"
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
          <tr v-if="!entries.length && !filesPending">
            <td colspan="5">
              <div class="flex flex-col items-center justify-center py-16 px-4">
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
                <div v-if="!showTrashed && !showTags" class="flex items-center gap-2">
                  <UButton
                    icon="i-lucide-folder-plus"
                    label="Create folder"
                    color="neutral"
                    variant="outline"
                    @click="createFolderOpen = true"
                  />
                  <UButton icon="i-lucide-upload" label="Upload files" @click="uploadOpen = true" />
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div ref="sentinel" class="h-px" />
      <div v-if="loadingMore" class="flex items-center justify-center py-4">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>
    </div>

    <UploadModal
      v-model:open="uploadOpen"
      :library-id="libraryId"
      :library-name="library?.name ?? 'Library'"
      :parent-folder-id="showTrashed || showTags ? null : currentFolderId"
    />

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId"
      :files="files"
      @navigate="previewFile = $event"
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

    <UModal v-model:open="deleteLibraryOpen" title="Delete Library">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            This will permanently delete the library
            <strong>{{ library?.name }}</strong
            >. This action cannot be undone.
          </p>
          <UFormField label="Type 'delete' to confirm">
            <UInput v-model="deleteLibraryConfirmation" placeholder="delete" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="deleteLibraryOpen = false"
          />
          <UButton
            label="Delete Library"
            color="error"
            icon="i-lucide-trash-2"
            :disabled="deleteLibraryConfirmation !== 'delete'"
            @click="deleteLibrary"
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
  </div>
</template>
