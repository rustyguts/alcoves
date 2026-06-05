<script setup lang="ts">
import { useApiFetch } from "~/composables/useApiFetch";

definePageMeta({ layout: "library" });

import { useLibraryTags } from "~/composables/useLibraryTags";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import AppIcon from "~/components/AppIcon.vue";
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
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold">Manage Tags</h1>
            <p class="text-sm text-muted">Create, color, and organize tags across your library.</p>
          </div>
          <UTooltip text="Refresh usage counts">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              square
              :loading="loadingUsage"
              icon="i-lucide-refresh-cw"
              @click="refreshTagUsageCounts"
            />
          </UTooltip>
        </div>
      </template>

      <div class="relative rounded-md overflow-hidden">
        <table class="w-full text-sm sm:table-fixed">
          <thead class="bg-elevated">
            <tr class="text-left">
              <th class="w-14 sm:w-20 px-4 py-3 font-medium">Color</th>
              <th class="px-4 py-3 font-medium">Name</th>
              <th class="hidden w-16 px-4 py-3 text-right font-medium sm:table-cell sm:w-24">
                Items
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr class="bg-default">
              <td class="px-4 py-3">
                <TagColorPickerDropdown
                  key-id="create"
                  :open="openColorDropdown === 'create'"
                  :color="createTagColor"
                  :draft="createTagColorDraft"
                  :palette="TAG_COLOR_PALETTE"
                  title="Select new tag color"
                  @toggle="toggleColorDropdown('create')"
                  @pick="selectCreateTagColor"
                  @update-draft="createTagColorDraft = $event"
                  @commit-draft="applyCreateColorDraft"
                />
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <UInput
                    v-model="createTagName"
                    size="sm"
                    placeholder="New tag"
                    :ui="{ root: 'flex-1 min-w-0' }"
                    @keydown.enter="createTagAndRefresh"
                  />
                  <UButton
                    color="primary"
                    variant="soft"
                    size="sm"
                    square
                    icon="i-lucide-plus"
                    :loading="creatingTag"
                    :disabled="!createTagName.trim() || creatingTag"
                    @click="createTagAndRefresh"
                  />
                </div>
              </td>
              <td class="hidden px-4 py-3 text-right text-sm text-muted sm:table-cell">-</td>
            </tr>

            <tr v-if="loading">
              <td colspan="3" class="px-4 py-3">
                <div class="flex items-center gap-2 text-sm text-muted">
                  <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
                  Loading tags
                </div>
              </td>
            </tr>

            <tr v-for="tag in sortedTags" :key="tag.id" class="transition hover:bg-elevated/50">
              <td class="px-4 py-3">
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
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <UInput
                    v-model="tagDraftNames[tag.id]"
                    size="sm"
                    :ui="{ root: 'w-full' }"
                    @blur="saveDraftTagName(tag)"
                    @keydown.enter="saveDraftTagName(tag)"
                  />
                  <UButton
                    color="error"
                    variant="soft"
                    size="sm"
                    square
                    icon="i-lucide-trash-2"
                    @click="deleteTagAndRefresh(tag.id)"
                  />
                </div>
              </td>
              <td class="hidden px-4 py-3 text-right text-sm sm:table-cell">
                <span v-if="loadingUsage" class="text-muted">...</span>
                <span v-else class="font-semibold">{{ usageCountFor(tag.id) }}</span>
              </td>
            </tr>

            <tr v-if="!loading && !sortedTags.length">
              <td colspan="3" class="px-4 py-8 text-center text-sm text-muted">No tags yet</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
