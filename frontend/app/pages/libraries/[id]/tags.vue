<script setup lang="ts">
import { useRoute } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import { useLibraryTags } from "~/composables/useLibraryTags";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import AppIcon from "~/components/AppIcon.vue";
import type { Library, LibraryFile, LibraryTag } from "~~/shared/types/api";

const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const toast = useToast();

const { data: library, refresh: refreshLibrary } = useApiFetch<Library>(() => `/api/libraries/${libraryId.value}`);
const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const canManageLibrary = computed(
  () => library.value?.currentUserRole === "owner" || library.value?.currentUserRole === "admin",
);

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

const libraryTags = ref<LibraryTag[]>([]);
const files = ref<LibraryFile[]>([]);
const loading = ref(true);

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

async function refreshTags() {
  libraryTags.value = await apiFetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`);
}

onMounted(async () => {
  try {
    await refreshTags();
  } catch {
    toast.add({ title: "Failed to load tags", color: "error" });
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0">
    <div class="grid gap-4">
      <div class="card bg-base-100 shadow-sm">
        <div class="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
          <div class="min-w-0">
            <p class="text-sm font-semibold">Create Tag</p>
            <p class="text-xs text-muted">Add labels to organize files and folders.</p>
          </div>
          <span class="badge badge-sm badge-ghost badge-soft">
            {{ `${libraryTags.length} ${libraryTags.length === 1 ? 'tag' : 'tags'}` }}
          </span>
        </div>
        <div class="card-body">
          <div class="flex flex-col sm:flex-row sm:items-end gap-2">
            <fieldset class="fieldset flex-1">
              <legend class="fieldset-legend">Tag name</legend>
              <div class="relative w-full">
                <AppIcon name="i-lucide-tag" class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
                <input
                  v-model="createTagName"
                  placeholder="Design docs"
                  class="input w-full pl-10"
                  @keydown.enter="createTag"
                />
              </div>
            </fieldset>
            <button
              class="btn btn-primary"
              :disabled="!createTagName.trim() || creatingTag"
              @click="createTag"
            >
              <span v-if="creatingTag" class="loading loading-spinner loading-xs"></span>
              <AppIcon v-else name="i-lucide-plus" class="size-4" />
              Create Tag
            </button>
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
          <p class="text-sm font-semibold">Manage Tags</p>
          <p class="text-xs text-muted">Click a color dot to open the palette.</p>
        </div>
        <div class="card-body">
          <div
            v-if="libraryTags.length"
            class="divide-y divide-default rounded-lg border border-default"
          >
            <div
              v-for="tag in libraryTags"
              :key="tag.id"
              class="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-3 bg-(--ui-bg)/40"
            >
              <details class="dropdown">
                <summary class="list-none">
                  <button
                    type="button"
                    class="size-8 rounded-full border-2 border-default cursor-pointer shadow-sm"
                    :style="{ backgroundColor: tag.color }"
                    :title="`Tag color: ${tag.color}`"
                  />
                </summary>
                <div class="dropdown-content bg-base-200 rounded-box p-2 shadow z-10">
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
                      @click="selectTagColor(tag, color); ($event.target as HTMLElement).closest('details')!.open = false"
                    />
                  </div>
                </div>
              </details>

              <div class="min-w-0 flex-1 flex items-center gap-2">
                <input
                  v-model="tagDraftNames[tag.id]"
                  class="input w-full flex-1"
                  @blur="saveDraftTagName(tag)"
                  @keydown.enter="saveDraftTagName(tag)"
                />
                <span class="badge badge-sm badge-ghost badge-outline shrink-0">{{ tag.color }}</span>
              </div>

              <button
                class="btn btn-sm btn-error btn-soft self-start sm:self-auto sm:ml-auto"
                @click="deleteTag(tag.id)"
              >
                <AppIcon name="i-lucide-trash-2" class="size-4" />
              </button>
            </div>
          </div>

          <div v-else class="rounded-lg border border-dashed border-default p-8 text-center">
            <AppIcon name="i-lucide-tags" class="size-8 text-muted mx-auto mb-2" />
            <p class="text-sm font-medium">No tags yet</p>
            <p class="text-xs text-muted mt-1">Create your first tag to start organizing content.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
