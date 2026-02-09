<script setup lang="ts">
import type { ContextMenuItem, DropdownMenuItem, BreadcrumbItem } from "@nuxt/ui";
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";
import { getMimeIcon, formatFileSize, formatDate } from "~/utils/mime-icons";

definePageMeta({
  layout: "dashboard",
});

const ENTRY_VIEW_STORAGE_KEY = "alcoves.library.entry-view";

const toast = useToast();

const {
  route,
  libraryId,
  user,
  library,
  refreshLibrary,
  libraryUsers,
  refreshLibraryUsers,
  viewMode,
  entryViewMode,
  showTrashed,
  showTags,
  showUsers,
  canManageUsers,
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

const editingName = ref(false);
const editName = ref("");
const renamingEntry = ref<LibraryEntry | null>(null);
const renameValue = ref("");
const uploadOpen = ref(false);
const {
  createTagName,
  creatingTag,
  tagDraftNames,
  isTagAssigned,
  isFolderTagAssigned,
  areAllFilesTagged,
  toggleTagForFolder,
  toggleTagForFiles,
  createTag,
  getTagColorChoices,
  isTagColorUsedByAnotherTag,
  selectTagColor,
  saveDraftTagName,
  deleteTag,
} = useLibraryTags(libraryId, libraryTags, files);
const {
  memberRoleDrafts,
  inviteEmail,
  inviteEmailRole,
  inviteByEmailLoading,
  createInviteLinkLoading,
  updatingMemberUserId,
  removingMemberUserId,
  revokingInviteId,
  inviteRoleOptions,
  libraryMembers,
  emailInvites,
  inviteLinks,
  memberAvatars,
  copyInviteLink,
  inviteUserByEmail,
  createInviteLink,
  updateMemberRole,
  removeMember,
  revokeInvite,
} = useLibraryMembers(libraryId, libraryUsers, refreshLibraryUsers);
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
  if (showUsers.value) {
    refreshLibraryUsers().catch(() => {
      toast.add({ title: "Failed to load library users", color: "error" });
    });
  }
  if (userToggledView.value && !showTags.value && !showUsers.value) {
    userToggledView.value = false;
    resetAndFetch();
  }
});

watch(entryViewMode, (next) => {
  if (!import.meta.client) return;
  localStorage.setItem(ENTRY_VIEW_STORAGE_KEY, next);
});

watch(
  canManageUsers,
  (allowed) => {
    if (!allowed && showUsers.value) {
      viewMode.value = "files";
    }
  },
  { immediate: true },
);

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
  await $fetch(`/api/libraries/${libraryId.value}`, {
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
  ids.forEach((id) => selectedFiles.delete(id));
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
  ids.forEach((id) => selectedFiles.delete(id));
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
    const targetFolderIds = selectedFolders.has(entry.id) ? [...selectedFolders] : [entry.id];
    const folderCount = targetFolderIds.length;

    if (showTags.value) return [];
    if (!canManageLibrary.value) {
      if (showTrashed.value) return [];
      return [
        [
          {
            label: "Open",
            icon: "i-lucide-folder-open",
            onSelect: () => openFolder(entry.id),
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
          label: count > 1 ? `Download ${count} files` : "Download",
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

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const canDeleteLibrary = computed(() => {
  if (!library.value || !user.value) return false;
  if (library.value.isDefault) return false;
  if (library.value.ownerId !== user.value.id) return false;
  if (showTrashed.value || showTags.value || showUsers.value) return false;
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
        <LibraryMemberAvatars
          v-if="!library?.isDefault && (memberAvatars?.length ?? 0) > 0"
          :members="memberAvatars ?? []"
        />
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
        <template v-if="canManageLibrary && !showTrashed && !showTags && !showUsers">
          <UDropdownMenu :items="newMenuItems">
            <UButton icon="i-lucide-plus" label="New" color="neutral" variant="outline" />
          </UDropdownMenu>
          <UButton icon="i-lucide-upload" label="Upload" @click="uploadOpen = true" />
        </template>
      </div>
    </div>

    <UBreadcrumb v-if="!showTrashed && !showTags && !showUsers" :items="breadcrumbItems" />

    <div class="flex justify-between gap-1 w-full">
      <div class="flex">
        <UButton
          label="Files"
          icon="i-lucide-folder"
          :variant="!showTrashed && !showTags && !showUsers ? 'soft' : 'ghost'"
          :color="!showTrashed && !showTags && !showUsers ? 'primary' : 'neutral'"
          size="sm"
          @click="
            userToggledView = true;
            viewMode = 'files';
          "
        />
        <UButton
          v-if="canManageUsers"
          label="Users"
          icon="i-lucide-users"
          :variant="showUsers ? 'soft' : 'ghost'"
          :color="showUsers ? 'primary' : 'neutral'"
          size="sm"
          @click="
            userToggledView = true;
            viewMode = 'users';
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
      </div>
      <div class="flex items-center gap-2">
        <div v-if="!showTags && !showUsers" class="flex items-center">
          <div class="inline-flex items-center">
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
      </div>
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
                <div class="p-2">
                  <div class="flex w-44 flex-wrap gap-2">
                    <button
                      v-for="color in getTagColorChoices(tag)"
                      :key="`${tag.id}-${color}`"
                      type="button"
                      class="aspect-square shrink-0 basis-[calc((100%-1.5rem)/4)] rounded-full border transition-transform disabled:cursor-not-allowed disabled:opacity-35"
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
              class="self-start sm:self-auto sm:ml-auto"
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

    <div v-else-if="showUsers" class="grid gap-4">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-semibold">Invite by Email</p>
              <p class="text-xs text-muted">
                Add a specific user directly or send a targeted invite.
              </p>
            </div>
            <UBadge
              color="neutral"
              variant="soft"
              :label="`${libraryMembers.length} ${libraryMembers.length === 1 ? 'member' : 'members'}`"
            />
          </div>
        </template>

        <div class="flex flex-col sm:flex-row gap-2">
          <UInput
            v-model="inviteEmail"
            type="email"
            placeholder="user@example.com"
            icon="i-lucide-mail"
            class="flex-1"
            @keydown.enter="inviteUserByEmail"
          />
          <USelectMenu
            v-model="inviteEmailRole"
            :items="inviteRoleOptions"
            value-key="value"
            class="w-full sm:w-32"
          />
          <UButton
            label="Invite"
            icon="i-lucide-user-plus"
            :loading="inviteByEmailLoading"
            :disabled="!inviteEmail.trim()"
            @click="inviteUserByEmail"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-semibold">Invite Links</p>
              <p class="text-xs text-muted">Reusable links for authenticated users.</p>
            </div>
            <div class="flex items-center gap-2">
              <UBadge color="neutral" variant="soft" :label="`${inviteLinks.length} active`" />
              <UButton
                label="Create Link"
                icon="i-lucide-link"
                size="sm"
                :loading="createInviteLinkLoading"
                @click="createInviteLink"
              />
            </div>
          </div>
        </template>

        <div
          v-if="inviteLinks.length"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <div
            v-for="invite in inviteLinks"
            :key="invite.id"
            class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3"
          >
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ invite.inviteUrl }}</p>
              <p class="text-xs text-muted">
                Used {{ invite.useCount }} {{ invite.useCount === 1 ? "time" : "times" }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                size="sm"
                @click="copyInviteLink(invite.inviteUrl)"
              />
              <UButton
                icon="i-lucide-x"
                color="error"
                variant="soft"
                size="sm"
                :loading="revokingInviteId === invite.id"
                @click="revokeInvite(invite.id)"
              />
            </div>
          </div>
        </div>
        <div v-else class="rounded-lg border border-dashed border-default p-6 text-center">
          <p class="text-sm text-muted">No active invite links</p>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <p class="text-sm font-semibold">Members</p>
        </template>

        <div class="divide-y divide-default rounded-lg border border-default">
          <div
            v-for="member in libraryMembers"
            :key="member.id"
            class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3"
          >
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <UAvatar
                :src="member.user.avatarUrl ?? undefined"
                :alt="member.user.displayName"
                size="sm"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">{{ member.user.displayName }}</p>
                <p class="text-xs text-muted truncate">{{ member.user.email }}</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <UBadge
                v-if="member.role === 'owner'"
                color="primary"
                variant="subtle"
                label="owner"
              />
              <template v-else>
                <USelectMenu
                  v-model="memberRoleDrafts[member.userId]"
                  :items="inviteRoleOptions"
                  value-key="value"
                  class="w-28"
                  :loading="updatingMemberUserId === member.userId"
                  @update:model-value="updateMemberRole(member)"
                />
                <UButton
                  icon="i-lucide-user-minus"
                  color="error"
                  variant="soft"
                  size="sm"
                  :loading="removingMemberUserId === member.userId"
                  @click="removeMember(member)"
                />
              </template>
            </div>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold">Pending Email Invites</p>
            <UBadge color="neutral" variant="soft" :label="`${emailInvites.length} pending`" />
          </div>
        </template>

        <div
          v-if="emailInvites.length"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <div
            v-for="invite in emailInvites"
            :key="invite.id"
            class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3"
          >
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">{{ invite.invitedEmail }}</p>
              <p class="text-xs text-muted truncate">{{ invite.inviteUrl }}</p>
            </div>
            <div class="flex items-center gap-2">
              <UBadge color="neutral" variant="outline" :label="invite.role" />
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                size="sm"
                @click="copyInviteLink(invite.inviteUrl)"
              />
              <UButton
                icon="i-lucide-x"
                color="error"
                variant="soft"
                size="sm"
                :loading="revokingInviteId === invite.id"
                @click="revokeInvite(invite.id)"
              />
            </div>
          </div>
        </div>
        <div v-else class="rounded-lg border border-dashed border-default p-6 text-center">
          <p class="text-sm text-muted">No pending invites</p>
        </div>
      </UCard>
    </div>

    <div v-else class="rounded-lg overflow-hidden bg-default/20">
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
                :class="isEntrySelected(entry) ? 'bg-primary/10' : 'hover:bg-elevated/50'"
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
              :class="
                isEntrySelected(entry)
                  ? 'ring-2 ring-primary/50 bg-primary/5'
                  : 'hover:bg-elevated/70'
              "
              @click="handleRowClick(entry, $event)"
              @dblclick="openEntry(entry)"
            >
              <div
                class="h-28 rounded-md bg-elevated mb-3 flex items-center justify-center overflow-hidden"
              >
                <template v-if="entry.kind === 'folder'">
                  <UIcon name="i-lucide-folder" class="size-10 text-muted" />
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
        <div v-if="canManageLibrary && !showTrashed && !showTags" class="flex items-center gap-2">
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
      :parent-folder-id="showTrashed || showTags || showUsers ? null : currentFolderId"
    />

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId || ''"
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
