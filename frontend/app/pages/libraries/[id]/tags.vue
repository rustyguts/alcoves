<script setup lang="ts">
import { useApiFetch } from "~/composables/useApiFetch";

definePageMeta({ layout: "library" });

import { useLibraryTags } from "~/composables/useLibraryTags";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import TagColorPickerDropdown from "~/components/library/TagColorPickerDropdown.vue";
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
const { refreshLibraries } = useLibrariesList();

watch(library, () => {
  refreshLibraries();
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
const createTagColor = ref<string>(TAG_COLOR_PALETTE[0] ?? "#3B82F6");
const createTagColorDraft = ref<string>(createTagColor.value);
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
  <div class="flex w-full flex-1 flex-col gap-4 overflow-y-auto px-0.5 pb-6">
    <AppPanel
      title="Tags"
      description="Colored labels you attach to files and folders."
      icon="i-lineicons-tag"
      flush
    >
      <template #actions>
        <span class="hidden text-xs text-muted tabular-nums sm:inline">
          {{ sortedTags.length }} {{ sortedTags.length === 1 ? "tag" : "tags" }}
        </span>
        <UTooltip text="Recount usage">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            square
            :loading="loadingUsage"
            icon="i-lineicons-reload"
            aria-label="Recount tag usage"
            @click="refreshTagUsageCounts"
          />
        </UTooltip>
      </template>

      <div class="divide-y divide-default overflow-hidden rounded-md bg-elevated">
        <!-- Create row — always present so a tag can be added in any state -->
        <div class="flex items-center gap-2 bg-default/40 px-3 py-2.5 sm:gap-3">
          <TagColorPickerDropdown
            key-id="create"
            :open="openColorDropdown === 'create'"
            :color="createTagColor"
            :draft="createTagColorDraft"
            :palette="TAG_COLOR_PALETTE"
            title="Choose new tag color"
            @toggle="toggleColorDropdown('create')"
            @pick="selectCreateTagColor"
            @update-draft="createTagColorDraft = $event"
            @commit-draft="applyCreateColorDraft"
          />
          <input
            v-model="createTagName"
            type="text"
            placeholder="Add a tag"
            aria-label="New tag name"
            class="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm text-highlighted ring-1 ring-transparent transition placeholder:text-muted hover:bg-elevated/70 hover:ring-default focus:bg-default focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            @keydown.enter="createTagAndRefresh"
          />
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lineicons-plus"
            label="Add"
            aria-label="Add tag"
            :loading="creatingTag"
            :disabled="!createTagName.trim() || creatingTag"
            @click="createTagAndRefresh"
          />
        </div>

        <!-- Loading (initial) -->
        <div v-if="loading" class="flex items-center gap-2 px-3 py-6 text-sm text-muted">
          <UIcon name="i-lineicons-spinner-solid" class="size-4 animate-spin" />
          Loading tags
        </div>

        <!-- Empty -->
        <div
          v-else-if="!sortedTags.length"
          class="flex flex-col items-center gap-1.5 px-3 py-12 text-center"
        >
          <UIcon name="i-lineicons-tag" class="size-6 text-muted" />
          <p class="text-sm font-medium text-default">No tags yet</p>
          <p class="text-xs text-muted">Add your first tag above to start organizing.</p>
        </div>

        <!-- Tag rows -->
        <template v-else>
          <div
            v-for="tag in sortedTags"
            :key="tag.id"
            class="group flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-elevated/60 sm:gap-3"
          >
            <TagColorPickerDropdown
              :key-id="tag.id"
              :open="openColorDropdown === tag.id"
              :color="tag.color"
              :draft="tagColorDrafts[tag.id] ?? tag.color"
              :palette="TAG_COLOR_PALETTE"
              @toggle="toggleColorDropdown(tag.id)"
              @pick="
                (color) => {
                  updateTagColor(tag, color);
                  tagColorDrafts[tag.id] = color;
                }
              "
              @update-draft="tagColorDrafts[tag.id] = $event"
              @commit-draft="applyTagColorDraft(tag)"
            />

            <div class="group/name relative min-w-0 flex-1">
              <input
                v-model="tagDraftNames[tag.id]"
                type="text"
                :aria-label="`Rename tag ${tag.name}`"
                class="w-full truncate rounded-md bg-transparent py-1 pl-1.5 pr-7 text-sm font-medium text-highlighted ring-1 ring-transparent transition hover:bg-elevated/70 hover:ring-default focus:bg-default focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                @blur="saveDraftTagName(tag)"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              />
              <UIcon
                name="i-lineicons-pencil"
                class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted opacity-0 transition-opacity group-hover/name:opacity-100 group-focus-within/name:opacity-0"
              />
            </div>

            <span class="w-20 shrink-0 text-right text-xs text-muted tabular-nums">
              <UIcon
                v-if="loadingUsage"
                name="i-lineicons-spinner-solid"
                class="inline size-3 animate-spin"
              />
              <template v-else>
                {{ usageCountFor(tag.id) }} {{ usageCountFor(tag.id) === 1 ? "item" : "items" }}
              </template>
            </span>

            <UButton
              color="error"
              variant="ghost"
              size="sm"
              square
              icon="i-lineicons-trash-can"
              :aria-label="`Delete tag ${tag.name}`"
              class="shrink-0 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              @click="deleteTagAndRefresh(tag.id)"
            />
          </div>
        </template>
      </div>
    </AppPanel>
  </div>
</template>
