<script setup lang="ts">
import { useRoute } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import { useLibraryTags } from "~/composables/useLibraryTags";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import AppIcon from "~/components/AppIcon.vue";
import type { Library, LibraryEntry, LibraryFile, LibraryTag, PaginatedFiles } from "~~/shared/types/api";

const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const toast = useToast();

const { data: library } = useApiFetch<Library>(() => `/api/libraries/${libraryId.value}`);
const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const libraryTags = ref<LibraryTag[]>([]);
const files = ref<LibraryFile[]>([]);
const loading = ref(true);
const loadingUsage = ref(false);
const tagUsageCounts = reactive<Record<string, number>>({});

const {
  createTagName,
  creatingTag,
  tagDraftNames,
  createTag,
  getTagColorChoices,
  isTagColorUsedByAnotherTag,
  selectTagColor,
  saveDraftTagName,
  deleteTag,
} = useLibraryTags(libraryId, libraryTags, files);

const sortedTags = computed(() => [...libraryTags.value].sort((a, b) => a.name.localeCompare(b.name)));

const tagCountLabel = computed(
  () => `${libraryTags.value.length} ${libraryTags.value.length === 1 ? "tag" : "tags"}`,
);

const uniqueColorCount = computed(
  () => new Set(libraryTags.value.map((tag) => tag.color.toUpperCase())).size,
);

function closeColorDropdown(target: EventTarget | null) {
  const trigger = target as HTMLElement | null;
  const details = trigger?.closest("details");
  if (details) {
    details.open = false;
  }
}

function setUsageCount(tagId: string, count: number) {
  tagUsageCounts[tagId] = count;
}

function usageCountFor(tagId: string): number {
  return tagUsageCounts[tagId] ?? 0;
}

function usageLabelFor(tagId: string): string {
  const count = usageCountFor(tagId);
  return `${count} ${count === 1 ? "item" : "items"}`;
}

async function fetchAllEntriesInFolder(folderId: string | null): Promise<LibraryEntry[]> {
  const collected: LibraryEntry[] = [];
  let cursor: string | null = null;

  do {
    const query: Record<string, string> = { limit: "200" };
    if (folderId) {
      query.folder = folderId;
    }
    if (cursor) {
      query.cursor = cursor;
    }

    const page = await apiFetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, { query });
    collected.push(...(page.entries ?? []));
    cursor = page.nextCursor;
  } while (cursor);

  return collected;
}

async function refreshTagUsageCounts() {
  loadingUsage.value = true;
  try {
    const counts: Record<string, number> = {};
    const folderQueue: Array<string | null> = [null];
    const seenFolderIds = new Set<string>();
    const seenEntryKeys = new Set<string>();

    while (folderQueue.length) {
      const folderId = folderQueue.shift() ?? null;
      const entries = await fetchAllEntriesInFolder(folderId);

      for (const entry of entries) {
        const entryKey = `${entry.kind}:${entry.id}`;
        if (seenEntryKeys.has(entryKey)) {
          continue;
        }
        seenEntryKeys.add(entryKey);

        for (const tag of entry.tags ?? []) {
          counts[tag.id] = (counts[tag.id] ?? 0) + 1;
        }

        if (entry.kind === "folder" && !seenFolderIds.has(entry.id)) {
          seenFolderIds.add(entry.id);
          folderQueue.push(entry.id);
        }
      }
    }

    for (const key of Object.keys(tagUsageCounts)) {
      delete tagUsageCounts[key];
    }
    for (const tag of libraryTags.value) {
      setUsageCount(tag.id, counts[tag.id] ?? 0);
    }
  } catch {
    toast.add({ title: "Failed to load tag usage counts", color: "error" });
  } finally {
    loadingUsage.value = false;
  }
}

async function createTagAndRefresh() {
  const before = new Set(libraryTags.value.map((tag) => tag.id));
  await createTag();
  for (const tag of libraryTags.value) {
    if (!before.has(tag.id)) {
      setUsageCount(tag.id, 0);
    }
  }
}

async function deleteTagAndRefresh(tagId: string) {
  await deleteTag(tagId);
  delete tagUsageCounts[tagId];
}

async function refreshTags() {
  libraryTags.value = await apiFetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`);
}

onMounted(async () => {
  try {
    await Promise.all([refreshTags(), refreshTagUsageCounts()]);
  } catch {
    toast.add({ title: "Failed to load tags", color: "error" });
  } finally {
    loading.value = false;
  }
});

watch(
  () => libraryId.value,
  async () => {
    loading.value = true;
    try {
      await Promise.all([refreshTags(), refreshTagUsageCounts()]);
    } catch {
      toast.add({ title: "Failed to load tags", color: "error" });
    } finally {
      loading.value = false;
    }
  },
);
</script>

<template>
  <div class="flex w-full flex-1 flex-col gap-4 overflow-y-auto pb-6">
    <section class="card border border-base-300/70 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 class="text-xl font-semibold">Tag Manager</h1>
            <p class="text-sm text-base-content/70">Add labels to organize files and folders.</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="badge badge-primary badge-outline">{{ tagCountLabel }}</span>
            <span class="badge badge-ghost badge-outline">
              {{ uniqueColorCount }} {{ uniqueColorCount === 1 ? "color" : "colors" }}
            </span>
            <button
              class="btn btn-ghost btn-sm"
              :disabled="loadingUsage"
              title="Refresh usage counts"
              @click="refreshTagUsageCounts"
            >
              <span v-if="loadingUsage" class="loading loading-spinner loading-xs"></span>
              <AppIcon v-else name="i-lucide-refresh-cw" class="size-4" />
            </button>
          </div>
        </div>

        <div class="rounded-box border border-base-300/70 bg-base-200/30 p-3">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:max-w-md">
              <label class="input input-sm w-full">
                <AppIcon name="i-lucide-tag" class="size-4 text-base-content/60" />
                <input
                  v-model="createTagName"
                  placeholder="Design docs"
                  @keydown.enter="createTagAndRefresh"
                />
              </label>
              <button
                class="btn btn-primary btn-sm"
                :disabled="!createTagName.trim() || creatingTag"
                @click="createTagAndRefresh"
              >
                <span v-if="creatingTag" class="loading loading-spinner loading-xs"></span>
                <AppIcon v-else name="i-lucide-plus" class="size-4" />
                Create
              </button>
            </div>

            <div class="flex flex-1 flex-wrap gap-2">
              <span
                v-for="tag in sortedTags"
                :key="`chip-${tag.id}`"
                class="badge badge-sm border-base-300 bg-base-100 px-3 py-3"
              >
                <span class="mr-2 size-2 rounded-full" :style="{ backgroundColor: tag.color }" />
                {{ tag.name }}
                <span class="ml-2 text-xs text-base-content/60">{{ usageCountFor(tag.id) }}</span>
              </span>
              <span v-if="!sortedTags.length" class="text-xs text-base-content/60">
                No tags yet
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card border border-base-300/70 bg-base-100 shadow-sm">
      <div class="card-body gap-3">
        <h2 class="card-title text-base">Manage Tags</h2>

        <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="i in 6" :key="i" class="rounded-box border border-base-300/70 bg-base-200/50 p-3">
            <div class="mb-2 flex items-center justify-between">
              <div class="skeleton size-7 rounded-full"></div>
              <div class="skeleton h-4 w-16"></div>
            </div>
            <div class="skeleton h-9 w-full"></div>
          </div>
        </div>

        <div v-else-if="sortedTags.length" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="tag in sortedTags"
            :key="tag.id"
            class="rounded-box border border-base-300/70 bg-base-200/40 p-3"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <details class="dropdown">
                <summary class="btn btn-sm btn-circle btn-ghost p-0">
                  <span
                    class="size-7 rounded-full border-2 border-base-300 shadow-sm"
                    :style="{ backgroundColor: tag.color }"
                    :title="`Tag color: ${tag.color}`"
                  />
                </summary>
                <div class="dropdown-content rounded-box z-20 mt-2 w-64 border border-base-300/80 bg-base-100 p-3 shadow-xl">
                  <div class="mb-2 text-xs font-medium text-base-content/70">Choose color</div>
                  <div class="grid grid-cols-4 gap-2">
                    <button
                      v-for="color in getTagColorChoices(tag)"
                      :key="`${tag.id}-${color}`"
                      type="button"
                      class="relative size-10 rounded-full border border-base-300 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                      :class="color === tag.color.toUpperCase() ? 'ring-2 ring-primary/40' : ''"
                      :style="{ backgroundColor: color }"
                      :title="isTagColorUsedByAnotherTag(tag.id, color) ? `${color} (used)` : color"
                      :disabled="isTagColorUsedByAnotherTag(tag.id, color)"
                      @click="selectTagColor(tag, color); closeColorDropdown($event.currentTarget)"
                    >
                      <AppIcon
                        v-if="color === tag.color.toUpperCase()"
                        name="i-lucide-check"
                        class="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow"
                      />
                    </button>
                  </div>
                </div>
              </details>
              <div class="flex items-center gap-2">
                <span class="badge badge-ghost badge-outline">{{ tag.color.toUpperCase() }}</span>
                <span class="badge badge-neutral badge-outline">
                  {{ loadingUsage ? "..." : usageLabelFor(tag.id) }}
                </span>
              </div>
            </div>

            <input
              v-model="tagDraftNames[tag.id]"
              class="input input-sm w-full"
              @blur="saveDraftTagName(tag)"
              @keydown.enter="saveDraftTagName(tag)"
            />

            <div class="mt-2 flex justify-end">
              <button class="btn btn-error btn-soft btn-xs" @click="deleteTagAndRefresh(tag.id)">
                <AppIcon name="i-lucide-trash-2" class="size-3.5" />
                Delete
              </button>
            </div>
          </article>
        </div>

        <div v-else class="rounded-box border border-dashed border-base-300 p-10 text-center">
          <AppIcon name="i-lucide-tags" class="mx-auto mb-3 size-9 text-base-content/50" />
          <p class="text-sm font-medium">No tags yet</p>
          <p class="mt-1 text-xs text-base-content/60">
            Create your first tag to start organizing content.
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
