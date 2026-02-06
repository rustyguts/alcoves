<script setup lang="ts">
import type { ContextMenuItem } from "@nuxt/ui";
import type { Library, LibraryFile, PaginatedFiles } from "~~/server/utils/types";
import {
  getMimeIcon,
  getFileNameWithoutExtension,
  formatFileSize,
  formatDate,
} from "~/utils/mime-icons";

definePageMeta({
  layout: "dashboard",
});

const route = useRoute();
const libraryId = computed(() => route.params.id as string);

const { user } = useAuth();

const { data: library, refresh: refreshLibrary } = await useFetch<Library>(
  () => `/api/libraries/${libraryId.value}`,
);

const showTrashed = ref(false);

// Paginated file state
// Initial SSR-compatible load - must come before refs that depend on it
// Forward browser cookies during SSR so auth works for $fetch calls inside useAsyncData
const ssrHeaders = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;
const { data: _init } = await useAsyncData(
  `library-init-${libraryId.value}`,
  async () => {
    const [result, trashedResult] = await Promise.all([
      $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
        headers: ssrHeaders,
      }),
      $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
        query: { trashed: "true", limit: "1" },
        headers: ssrHeaders,
      }),
    ]);
    return { result, trashedCount: trashedResult.totalCount };
  },
  { watch: [libraryId] },
);

// Initialize refs with SSR data if available
const files = ref<LibraryFile[]>(_init.value?.result.files ?? []);
const nextCursor = ref<string | null>(_init.value?.result.nextCursor ?? null);
const totalCount = ref(_init.value?.result.totalCount ?? 0);
const trashedCount = ref(_init.value?.trashedCount ?? 0);
const loadingMore = ref(false);
const filesPending = ref(!_init.value);

const selected = reactive(new Set<string>());

async function fetchPage(cursor?: string): Promise<PaginatedFiles> {
  const query: Record<string, string> = {};
  if (showTrashed.value) query.trashed = "true";
  if (cursor) query.cursor = cursor;
  return $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, { query });
}

async function loadMore() {
  if (loadingMore.value || !nextCursor.value) return;
  loadingMore.value = true;
  try {
    const result = await fetchPage(nextCursor.value);
    files.value.push(...result.files);
    nextCursor.value = result.nextCursor;
    totalCount.value = result.totalCount;
  } finally {
    loadingMore.value = false;
  }
}

async function resetAndFetch() {
  filesPending.value = true;
  files.value = [];
  nextCursor.value = null;
  selected.clear();
  try {
    const result = await fetchPage();
    files.value = result.files;
    nextCursor.value = result.nextCursor;
    totalCount.value = result.totalCount;
  } finally {
    filesPending.value = false;
  }
}

// Sync from SSR initial data
watchEffect(() => {
  if (!_init.value) return;
  files.value = _init.value.result.files;
  nextCursor.value = _init.value.result.nextCursor;
  totalCount.value = _init.value.result.totalCount;
  trashedCount.value = _init.value.trashedCount;
  filesPending.value = false;
});

const lastClickedIndex = ref<number | null>(null);
const editingName = ref(false);
const editName = ref("");
const renamingFileId = ref<string | null>(null);
const renameValue = ref("");
const uploadOpen = ref(false);

// File preview state
const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);

function openPreview(file: LibraryFile) {
  previewFile.value = file;
  previewOpen.value = true;
}

// Library delete state
const deleteLibraryOpen = ref(false);
const deleteLibraryConfirmation = ref("");

// Trash permanent delete state
const purgeModalOpen = ref(false);
const purgeConfirmation = ref("");
const filesToPurge = ref<string[]>([]);
const purgeAll = ref(false);

// Upload queue integration
const { onLibraryUploadComplete, removeOnComplete } = useUploadQueue();

onLibraryUploadComplete(libraryId.value, () => {
  if (!showTrashed.value) resetAndFetch();
});

// Track if view toggle was user-initiated
const userToggledView = ref(false);

// Reset view when navigating between libraries (without triggering refetch)
watch(libraryId, () => {
  showTrashed.value = false;
});

// View toggle: reset and refetch only on user toggle
watch(showTrashed, () => {
  if (userToggledView.value) {
    userToggledView.value = false;
    resetAndFetch();
  }
});

// Infinite scroll observer
const sentinel = ref<HTMLElement | null>(null);

onMounted(() => {
  const el = sentinel.value;
  if (!el) return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && nextCursor.value && !loadingMore.value) {
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

function handleRowClick(fileId: string, event: MouseEvent) {
  event.preventDefault();
  const fileList = files.value;
  const clickedIndex = fileList.findIndex((f) => f.id === fileId);

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
    if (selected.has(fileId)) {
      selected.delete(fileId);
    } else {
      selected.add(fileId);
    }
    lastClickedIndex.value = clickedIndex;
  } else {
    selected.clear();
    selected.add(fileId);
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
  files.value = files.value.filter((f) => !ids.includes(f.id));
  totalCount.value -= ids.length;
  trashedCount.value += ids.length;
}

async function restoreFiles(ids: string[]) {
  await $fetch(`/api/libraries/${libraryId.value}/files/restore`, {
    method: "POST",
    body: { fileIds: ids },
  });
  ids.forEach((id) => selected.delete(id));
  files.value = files.value.filter((f) => !ids.includes(f.id));
  totalCount.value -= ids.length;
  trashedCount.value -= ids.length;
}

function openPurgeModal(ids: string[]) {
  purgeAll.value = false;
  filesToPurge.value = ids;
  purgeConfirmation.value = "";
  purgeModalOpen.value = true;
}

function openPurgeAllModal() {
  purgeAll.value = true;
  filesToPurge.value = [];
  purgeConfirmation.value = "";
  purgeModalOpen.value = true;
}

async function handlePermanentDelete() {
  if (purgeAll.value) {
    await $fetch(`/api/libraries/${libraryId.value}/files/purge`, {
      method: "POST",
      body: { all: true },
    });
    files.value = [];
    nextCursor.value = null;
    totalCount.value = 0;
    trashedCount.value = 0;
  } else {
    await $fetch(`/api/libraries/${libraryId.value}/files/purge`, {
      method: "POST",
      body: { fileIds: filesToPurge.value },
    });
    const purgedIds = new Set(filesToPurge.value);
    purgedIds.forEach((id) => selected.delete(id));
    files.value = files.value.filter((f) => !purgedIds.has(f.id));
    totalCount.value -= purgedIds.size;
    trashedCount.value -= purgedIds.size;
  }
  purgeModalOpen.value = false;
  purgeConfirmation.value = "";
  filesToPurge.value = [];
}

function getContextMenuItems(fileId: string): ContextMenuItem[][] {
  const targetIds = selected.has(fileId) ? [...selected] : [fileId];
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
              const file = files.value.find((f) => f.id === targetIds[0]);
              if (!file) return;
              renamingFileId.value = file.id;
              renameValue.value = file.name;
            },
          },
        ]
        : []),
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

async function saveFileRename(fileId: string) {
  if (!renameValue.value.trim()) {
    renamingFileId.value = null;
    return;
  }
  await $fetch(`/api/libraries/${libraryId.value}/files/${fileId}`, {
    method: "PATCH",
    body: { name: renameValue.value.trim() },
  });
  renamingFileId.value = null;
  const file = files.value.find((f) => f.id === fileId);
  if (file) file.name = renameValue.value.trim();
}

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const canDeleteLibrary = computed(() => {
  if (!library.value || !user.value) return false;
  if (library.value.isDefault) return false;
  if (library.value.ownerId !== user.value.id) return false;
  if (showTrashed.value) return false;
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
  purgeAll.value ? totalCount.value : filesToPurge.value.length,
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between h-10">
      <div class="flex items-center gap-2">
        <h1 v-if="!editingName" class="text-xl font-semibold cursor-pointer hover:text-primary"
          @click="startLibraryRename">
          {{ library?.name }}
        </h1>
        <UInput v-else v-model="editName" autofocus size="lg" @blur="saveLibraryName" @keydown.enter="saveLibraryName"
          @keydown.escape="editingName = false" />
      </div>
      <div class="flex items-center gap-2">
        <UButton v-if="showTrashed && !filesPending && totalCount > 0" label="Permanently Delete All"
          icon="i-lucide-trash-2" color="error" variant="soft" @click="openPurgeAllModal()" />
        <UButton v-if="canDeleteLibrary" label="Delete Library" icon="i-lucide-trash-2" color="error" variant="soft"
          @click="deleteLibraryOpen = true" />
        <UButton v-if="!showTrashed" icon="i-lucide-upload" label="Upload" @click="uploadOpen = true" />
      </div>
    </div>

    <div class="flex items-center gap-1">
      <UButton label="Files" icon="i-lucide-folder" :variant="!showTrashed ? 'soft' : 'ghost'"
        :color="!showTrashed ? 'primary' : 'neutral'" size="sm" @click="
          userToggledView = true;
        showTrashed = false;
        " />
      <UButton label="Trash" icon="i-lucide-trash-2" :variant="showTrashed ? 'soft' : 'ghost'"
        :color="showTrashed ? 'primary' : 'neutral'" size="sm" @click="
          userToggledView = true;
        showTrashed = true;
        " />
    </div>

    <div class="border border-default rounded-lg overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-default bg-elevated/50">
            <th class="w-10 px-3 py-2" />
            <th class="text-left text-xs font-medium text-muted px-3 py-2">Name</th>
            <th class="text-left text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">
              {{ showTrashed ? "Trashed" : "Modified" }}
            </th>
            <th class="text-right text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">
              Size
            </th>
          </tr>
        </thead>
        <tbody class="select-none">
          <template v-for="file in files" :key="file.id">
            <UContextMenu :items="getContextMenuItems(file.id)">
              <tr class="border-b border-default last:border-b-0 cursor-pointer transition-colors"
                :class="selected.has(file.id) ? 'bg-primary/10' : 'hover:bg-elevated/50'"
                @click="handleRowClick(file.id, $event)" @dblclick="openPreview(file)">
                <td class="px-3 py-2">
                  <div class="flex items-center justify-center">
                    <UIcon :name="getMimeIcon(file.mimeType)" class="size-5 text-muted"
                      :class="showTrashed ? 'opacity-50' : ''" />
                  </div>
                </td>
                <td class="px-3 py-2">
                  <UInput v-if="renamingFileId === file.id" v-model="renameValue" size="sm" autofocus
                    @blur="saveFileRename(file.id)" @keydown.enter="saveFileRename(file.id)"
                    @keydown.escape="renamingFileId = null" @click.stop />
                  <span v-else class="text-sm" :class="showTrashed ? 'opacity-60' : ''">{{
                    getFileNameWithoutExtension(file.name)
                    }}</span>
                </td>
                <td class="px-3 py-2 text-sm text-muted hidden sm:table-cell">
                  {{
                    showTrashed && file.trashedAt
                      ? formatDate(file.trashedAt)
                      : formatDate(file.updatedAt)
                  }}
                </td>
                <td class="px-3 py-2 text-sm text-muted text-right hidden sm:table-cell">
                  {{ formatFileSize(file.size) }}
                </td>
              </tr>
            </UContextMenu>
          </template>
          <tr v-if="!files.length && !filesPending">
            <td colspan="4">
              <div class="flex flex-col items-center justify-center py-16 px-4">
                <div class="size-16 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center mb-4">
                  <UIcon :name="showTrashed ? 'i-lucide-trash-2' : 'i-lucide-folder-open'"
                    class="size-8 text-(--ui-text-muted)" />
                </div>
                <p class="text-lg font-medium text-foreground mb-1">
                  {{ showTrashed ? "Trash is empty" : "No files yet" }}
                </p>
                <p class="text-sm text-muted mb-4">
                  {{
                    showTrashed
                      ? "Deleted files will appear here"
                      : "Upload some files to get started with your library"
                  }}
                </p>
                <UButton v-if="!showTrashed" icon="i-lucide-upload" label="Upload files" @click="uploadOpen = true" />
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

    <UploadModal v-model:open="uploadOpen" :library-id="libraryId" :library-name="library?.name ?? 'Library'" />

    <FilePreview v-if="previewFile" v-model:open="previewOpen" :file="previewFile" :library-id="libraryId" />

    <UModal v-model:open="deleteLibraryOpen" title="Delete Library">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            This will permanently delete the library
            <strong>{{ library?.name }}</strong>. This action cannot be undone.
          </p>
          <UFormField label="Type 'delete' to confirm">
            <UInput v-model="deleteLibraryConfirmation" placeholder="delete" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="outline" @click="deleteLibraryOpen = false" />
          <UButton label="Delete Library" color="error" icon="i-lucide-trash-2"
            :disabled="deleteLibraryConfirmation !== 'delete'" @click="deleteLibrary" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="purgeModalOpen" title="Permanently Delete Files">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            This will permanently delete
            <strong>{{ purgeFileCount }}</strong>
            {{ purgeFileCount === 1 ? "file" : "files" }} from disk. This action cannot be undone.
          </p>
          <UFormField label="Type 'delete' to confirm">
            <UInput v-model="purgeConfirmation" placeholder="delete" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="outline" @click="purgeModalOpen = false" />
          <UButton label="Delete Permanently" color="error" icon="i-lucide-trash-2"
            :disabled="purgeConfirmation !== 'delete'" @click="handlePermanentDelete" />
        </div>
      </template>
    </UModal>
  </div>
</template>
