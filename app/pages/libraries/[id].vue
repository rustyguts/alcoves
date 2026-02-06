<script setup lang="ts">
import type { ContextMenuItem } from "@nuxt/ui";
import type { Library, LibraryFile } from "~~/server/utils/types";
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

const { data: library, refresh: refreshLibrary } = await useFetch<Library>(
  () => `/api/libraries/${libraryId.value}`,
);

const showTrashed = ref(false);

const {
  data: files,
  refresh: refreshFiles,
  pending: filesPending,
} = await useFetch<LibraryFile[]>(() => `/api/libraries/${libraryId.value}/files`, {
  query: { trashed: computed(() => (showTrashed.value ? "true" : undefined)) },
});

const selected = reactive(new Set<string>());
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

// Trash permanent delete state
const purgeModalOpen = ref(false);
const purgeConfirmation = ref("");
const filesToPurge = ref<string[]>([]);

// Upload queue integration
const { onLibraryUploadComplete, removeOnComplete } = useUploadQueue();

onLibraryUploadComplete(libraryId.value, () => {
  if (!showTrashed.value) refreshFiles();
});

onUnmounted(() => removeOnComplete(libraryId.value));

// Clear selection when switching views
watch(showTrashed, () => {
  selected.clear();
});

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
  const fileList = files.value ?? [];
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
  await refreshFiles();
}

async function restoreFiles(ids: string[]) {
  await $fetch(`/api/libraries/${libraryId.value}/files/restore`, {
    method: "POST",
    body: { fileIds: ids },
  });
  ids.forEach((id) => selected.delete(id));
  await refreshFiles();
}

function openPurgeModal(ids: string[]) {
  filesToPurge.value = ids;
  purgeConfirmation.value = "";
  purgeModalOpen.value = true;
}

async function handlePermanentDelete() {
  await $fetch(`/api/libraries/${libraryId.value}/files/purge`, {
    method: "POST",
    body: { fileIds: filesToPurge.value },
  });
  filesToPurge.value.forEach((id) => selected.delete(id));
  purgeModalOpen.value = false;
  purgeConfirmation.value = "";
  filesToPurge.value = [];
  await refreshFiles();
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
                const file = files.value?.find((f) => f.id === targetIds[0]);
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
  await refreshFiles();
}

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
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
          v-if="showTrashed && !filesPending && files?.length"
          label="Permanently Delete All"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          size="sm"
          @click="openPurgeModal(files!.map((f) => f.id))"
        />
        <UButton
          v-if="!showTrashed"
          icon="i-lucide-upload"
          label="Upload"
          @click="uploadOpen = true"
        />
      </div>
    </div>

    <div class="flex items-center gap-1">
      <UButton
        label="Files"
        icon="i-lucide-folder"
        :variant="!showTrashed ? 'soft' : 'ghost'"
        :color="!showTrashed ? 'primary' : 'neutral'"
        size="sm"
        @click="showTrashed = false"
      />
      <UButton
        label="Trash"
        icon="i-lucide-trash-2"
        :variant="showTrashed ? 'soft' : 'ghost'"
        :color="showTrashed ? 'primary' : 'neutral'"
        size="sm"
        @click="showTrashed = true"
      />
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
              <tr
                class="border-b border-default last:border-b-0 cursor-pointer transition-colors"
                :class="selected.has(file.id) ? 'bg-primary/10' : 'hover:bg-elevated/50'"
                @click="handleRowClick(file.id, $event)"
                @dblclick="openPreview(file)"
              >
                <td class="px-3 py-2 text-center">
                  <UIcon
                    :name="getMimeIcon(file.mimeType)"
                    class="size-5 text-muted"
                    :class="showTrashed ? 'opacity-50' : ''"
                  />
                </td>
                <td class="px-3 py-2">
                  <UInput
                    v-if="renamingFileId === file.id"
                    v-model="renameValue"
                    size="sm"
                    autofocus
                    @blur="saveFileRename(file.id)"
                    @keydown.enter="saveFileRename(file.id)"
                    @keydown.escape="renamingFileId = null"
                    @click.stop
                  />
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
          <tr v-if="!files?.length">
            <td colspan="4" class="px-3 py-12 text-center text-muted text-sm">
              {{
                showTrashed ? "Trash is empty." : "No files yet. Upload some files to get started."
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UploadModal
      v-model:open="uploadOpen"
      :library-id="libraryId"
      :library-name="library?.name ?? 'Library'"
    />

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId"
    />

    <UModal v-model:open="purgeModalOpen" title="Permanently Delete Files">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            This will permanently delete
            <strong>{{ filesToPurge.length }}</strong>
            {{ filesToPurge.length === 1 ? "file" : "files" }} from disk. This action cannot be
            undone.
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
