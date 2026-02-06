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
const { data: files, refresh: refreshFiles } = await useFetch<LibraryFile[]>(
  () => `/api/libraries/${libraryId.value}/files`,
);

const selected = reactive(new Set<string>());
const editingName = ref(false);
const editName = ref("");
const renamingFileId = ref<string | null>(null);
const renameValue = ref("");
const uploadOpen = ref(false);

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
  if (event.ctrlKey || event.metaKey) {
    if (selected.has(fileId)) {
      selected.delete(fileId);
    } else {
      selected.add(fileId);
    }
  } else {
    selected.clear();
    selected.add(fileId);
  }
}

function getContextMenuItems(fileId: string): ContextMenuItem[][] {
  const targetIds = selected.has(fileId) ? [...selected] : [fileId];
  const count = targetIds.length;

  return [
    [
      {
        label: "Download",
        icon: "i-lucide-download",
        onSelect() {
          console.log("Download:", targetIds);
        },
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
        async onSelect() {
          await $fetch(`/api/libraries/${libraryId.value}/files/${targetIds[0]}`, {
            method: "DELETE",
            body: { fileIds: targetIds },
          });
          targetIds.forEach((id) => selected.delete(id));
          await refreshFiles();
        },
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

async function onUploadComplete() {
  uploadOpen.value = false;
  await refreshFiles();
}

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
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
      <UButton icon="i-lucide-upload" label="Upload" @click="uploadOpen = true" />
    </div>

    <div class="border border-default rounded-lg overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="border-b border-default bg-elevated/50">
            <th class="w-10 px-3 py-2" />
            <th class="text-left text-xs font-medium text-muted px-3 py-2">Name</th>
            <th class="text-left text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">Modified</th>
            <th class="text-right text-xs font-medium text-muted px-3 py-2 hidden sm:table-cell">Size</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="file in files" :key="file.id">
            <UContextMenu :items="getContextMenuItems(file.id)">
              <tr
                class="border-b border-default last:border-b-0 cursor-pointer transition-colors"
                :class="selected.has(file.id) ? 'bg-primary/10' : 'hover:bg-elevated/50'"
                @click="handleRowClick(file.id, $event)"
              >
                <td class="px-3 py-2 text-center">
                  <UIcon :name="getMimeIcon(file.mimeType)" class="size-5 text-muted" />
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
                  <span v-else class="text-sm">{{ getFileNameWithoutExtension(file.name) }}</span>
                </td>
                <td class="px-3 py-2 text-sm text-muted hidden sm:table-cell">
                  {{ formatDate(file.updatedAt) }}
                </td>
                <td class="px-3 py-2 text-sm text-muted text-right hidden sm:table-cell">
                  {{ formatFileSize(file.size) }}
                </td>
              </tr>
            </UContextMenu>
          </template>
          <tr v-if="!files?.length">
            <td colspan="4" class="px-3 py-12 text-center text-muted text-sm">
              No files yet. Upload some files to get started.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UploadModal
      v-model:open="uploadOpen"
      :library-id="libraryId"
      @complete="onUploadComplete"
    />
  </div>
</template>
