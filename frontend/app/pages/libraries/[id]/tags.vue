<script setup lang="ts">
import { useRoute } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import { useLibraryTags } from "~/composables/useLibraryTags";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import AppIcon from "~/components/AppIcon.vue";
import { TAG_COLOR_PALETTE } from "~~/shared/tag-colors";
import type {
  Library,
  LibraryEntry,
  LibraryFile,
  LibraryTag,
  PaginatedFiles,
} from "~~/shared/types/api";

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
  updateTagColor,
  saveDraftTagName,
  deleteTag,
} = useLibraryTags(libraryId, libraryTags, files);

const sortedTags = computed(() =>
  [...libraryTags.value].sort((a, b) => a.name.localeCompare(b.name)),
);
const createTagColor = ref(TAG_COLOR_PALETTE[0] ?? "#3B82F6");
const createTagColorDraft = ref(createTagColor.value);
const tagColorDrafts = reactive<Record<string, string>>({});
const openColorDropdown = ref<string | null>(null);

function closeColorDropdown(event: Event) {
  const trigger = event.target as HTMLElement | null;
  if (trigger?.closest("[data-color-dropdown]")) return;
  openColorDropdown.value = null;
}

function toggleColorDropdown(key: string) {
  openColorDropdown.value = openColorDropdown.value === key ? null : key;
}

function setUsageCount(tagId: string, count: number) {
  tagUsageCounts[tagId] = count;
}

function usageCountFor(tagId: string): number {
  return tagUsageCounts[tagId] ?? 0;
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

    const page = await apiFetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
      query,
    });
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

function selectCreateTagColor(color: string) {
  createTagColor.value = color.toUpperCase();
  createTagColorDraft.value = createTagColor.value;
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (/^#[0-9A-F]{6}$/.test(withHash)) return withHash;
  if (/^#[0-9A-F]{3}$/.test(withHash)) {
    const chars = withHash.slice(1).split("");
    return `#${chars[0]}${chars[0]}${chars[1]}${chars[1]}${chars[2]}${chars[2]}`;
  }
  return null;
}

function applyCreateColorDraft() {
  const normalized = normalizeHexColor(createTagColorDraft.value);
  if (!normalized) {
    toast.add({ title: "Color must be a valid hex code", color: "error" });
    createTagColorDraft.value = createTagColor.value;
    return;
  }
  createTagColor.value = normalized;
  createTagColorDraft.value = normalized;
}

async function applyTagColorDraft(tag: LibraryTag) {
  const draft = tagColorDrafts[tag.id] ?? tag.color;
  const normalized = normalizeHexColor(draft);
  if (!normalized) {
    toast.add({ title: "Color must be a valid hex code", color: "error" });
    tagColorDrafts[tag.id] = tag.color.toUpperCase();
    return;
  }
  tagColorDrafts[tag.id] = normalized;
  await updateTagColor(tag, normalized);
}

async function createTagAndRefresh() {
  const before = new Set(libraryTags.value.map((tag) => tag.id));
  await createTag(createTagColor.value);
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
  document.addEventListener("click", closeColorDropdown);
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

watch(sortedTags, () => {
  createTagColorDraft.value = createTagColor.value;
  for (const tag of sortedTags.value) {
    tagColorDrafts[tag.id] = tag.color.toUpperCase();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeColorDropdown);
});
</script>

<template>
  <div class="flex w-full flex-1 flex-col gap-4 overflow-y-auto pb-6">
    <section class="card border border-base-300/70 bg-base-100 shadow-sm">
      <div class="card-body gap-3">
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-xl font-semibold">Manage Tags</h1>
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

        <div class="relative rounded-box border border-base-300/70">
          <table class="table table-zebra w-full sm:table-fixed">
            <thead>
              <tr>
                <th class="w-14 sm:w-20">Color</th>
                <th>Name</th>
                <th class="hidden w-16 text-right sm:table-cell sm:w-24">Items</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <details
                    class="dropdown"
                    data-color-dropdown
                    :open="openColorDropdown === 'create'"
                  >
                    <summary
                      class="btn btn-sm btn-circle btn-ghost p-0"
                      title="Select new tag color"
                      @click.prevent="toggleColorDropdown('create')"
                    >
                      <span
                        class="size-4 rounded-full"
                        :style="{ backgroundColor: createTagColor }"
                      />
                    </summary>
                    <div
                      class="dropdown-content rounded-box z-20 mt-2 w-52 border border-base-300/80 bg-base-100 p-4 shadow-xl"
                    >
                      <div class="grid grid-cols-4 gap-2">
                        <button
                          v-for="color in TAG_COLOR_PALETTE"
                          :key="`create-${color}`"
                          type="button"
                          class="relative size-9 rounded-full border border-base-300 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                          :class="
                            color === createTagColor.toUpperCase() ? 'ring-2 ring-primary/40' : ''
                          "
                          :style="{ backgroundColor: color }"
                          :title="color"
                          @click="selectCreateTagColor(color)"
                        >
                          <AppIcon
                            v-if="color === createTagColor.toUpperCase()"
                            name="i-lucide-check"
                            class="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow"
                          />
                        </button>
                      </div>
                      <input
                        v-model="createTagColorDraft"
                        class="input input-sm mt-2 w-full font-mono uppercase"
                        placeholder="#3B82F6"
                        @blur="applyCreateColorDraft"
                        @keydown.enter.prevent="applyCreateColorDraft"
                      />
                    </div>
                  </details>
                </td>
                <td>
                  <div class="flex items-center gap-2">
                    <input
                      v-model="createTagName"
                      class="input input-sm min-w-0 flex-1"
                      placeholder="New tag"
                      @keydown.enter="createTagAndRefresh"
                    />
                    <button
                      class="btn btn-primary btn-sm btn-square shrink-0"
                      :disabled="!createTagName.trim() || creatingTag"
                      @click="createTagAndRefresh"
                    >
                      <span v-if="creatingTag" class="loading loading-spinner loading-xs"></span>
                      <AppIcon v-else name="i-lucide-plus" class="size-4" />
                    </button>
                  </div>
                </td>
                <td class="hidden text-right text-sm text-base-content/60 sm:table-cell">-</td>
              </tr>

              <tr v-if="loading">
                <td colspan="3">
                  <div class="flex items-center gap-2 py-2 text-sm text-base-content/70">
                    <span class="loading loading-spinner loading-sm"></span>
                    Loading tags
                  </div>
                </td>
              </tr>

              <tr v-for="tag in sortedTags" :key="tag.id">
                <td>
                  <details
                    class="dropdown"
                    data-color-dropdown
                    :open="openColorDropdown === tag.id"
                  >
                    <summary
                      class="btn btn-sm btn-circle btn-ghost p-0"
                      @click.prevent="toggleColorDropdown(tag.id)"
                    >
                      <span class="size-4 rounded-full" :style="{ backgroundColor: tag.color }" />
                    </summary>
                    <div
                      class="dropdown-content rounded-box z-20 mt-2 w-52 border border-base-300/80 bg-base-100 p-4 shadow-xl"
                    >
                      <div class="grid grid-cols-4 gap-2">
                        <button
                          v-for="color in TAG_COLOR_PALETTE"
                          :key="`${tag.id}-${color}`"
                          type="button"
                          class="relative size-9 rounded-full border border-base-300 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                          :class="color === tag.color.toUpperCase() ? 'ring-2 ring-primary/40' : ''"
                          :style="{ backgroundColor: color }"
                          :title="color"
                          @click="
                            updateTagColor(tag, color);
                            tagColorDrafts[tag.id] = color;
                          "
                        >
                          <AppIcon
                            v-if="color === tag.color.toUpperCase()"
                            name="i-lucide-check"
                            class="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow"
                          />
                        </button>
                      </div>
                      <input
                        v-model="tagColorDrafts[tag.id]"
                        class="input input-sm mt-2 w-full font-mono uppercase"
                        placeholder="#3B82F6"
                        @blur="applyTagColorDraft(tag)"
                        @keydown.enter.prevent="applyTagColorDraft(tag)"
                      />
                    </div>
                  </details>
                </td>
                <td>
                  <div class="flex items-center gap-2">
                    <input
                      v-model="tagDraftNames[tag.id]"
                      class="input input-sm w-full"
                      @blur="saveDraftTagName(tag)"
                      @keydown.enter="saveDraftTagName(tag)"
                    />
                    <button
                      class="btn btn-error btn-sm btn-square"
                      @click="deleteTagAndRefresh(tag.id)"
                    >
                      <AppIcon name="i-lucide-trash-2" class="size-4" />
                    </button>
                  </div>
                </td>
                <td class="hidden text-right text-sm sm:table-cell">
                  <span v-if="loadingUsage" class="text-base-content/60">...</span>
                  <span v-else class="font-semibold">{{ usageCountFor(tag.id) }}</span>
                </td>
              </tr>

              <tr v-if="!loading && !sortedTags.length">
                <td colspan="3" class="py-8 text-center text-sm text-base-content/60">
                  No tags yet
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>
