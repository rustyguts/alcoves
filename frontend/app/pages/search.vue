<script setup lang="ts">
import type { GlobalSearchResponse, GlobalSearchResult, LibraryFile } from "~~/shared/types/api";

definePageMeta({ layout: "dashboard" });
import { formatDate, formatFileSize, getMimeIcon } from "~/utils/mime-icons";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import AlcovesImage from "~/components/AlcovesImage.vue";
import FilePreview from "~/components/FilePreview.vue";

const MIN_QUERY_LENGTH = 2;
const SEARCH_LIMIT = 80;

const route = useRoute();
const router = useRouter();
const searchInput = ref("");

const routeSearchQuery = computed(() => {
  const raw = route.query.q;
  return typeof raw === "string" ? raw : "";
});
const activeQuery = computed(() => routeSearchQuery.value.trim());

watch(
  routeSearchQuery,
  (value) => {
    searchInput.value = value;
  },
  { immediate: true },
);

function createEmptySearchResponse(query = ""): GlobalSearchResponse {
  return { query, totalCount: 0, results: [] };
}

const {
  data: searchData,
  status,
  error,
  execute,
} = useApiFetch<GlobalSearchResponse>("/api/search", {
  query: computed(() => ({ q: activeQuery.value, limit: String(SEARCH_LIMIT) })),
  immediate: false,
  default: () => createEmptySearchResponse(),
});

watch(
  activeQuery,
  async (value) => {
    if (value.length < MIN_QUERY_LENGTH) {
      searchData.value = createEmptySearchResponse(value);
      return;
    }
    await execute();
  },
  { immediate: true },
);

async function submitSearch() {
  const query = searchInput.value.trim();
  router.push(query ? { path: "/search", query: { q: query } } : { path: "/search" });
}

const results = computed(() => searchData.value?.results ?? []);
const groupedResults = computed(() => {
  const groups: Array<{
    libraryId: string;
    libraryName: string;
    results: GlobalSearchResult[];
  }> = [];
  const byLibraryId = new Map<
    string,
    { libraryId: string; libraryName: string; results: GlobalSearchResult[] }
  >();

  for (const result of results.value) {
    let group = byLibraryId.get(result.libraryId);
    if (!group) {
      group = { libraryId: result.libraryId, libraryName: result.libraryName, results: [] };
      byLibraryId.set(result.libraryId, group);
      groups.push(group);
    }
    group.results.push(result);
  }

  return groups;
});

function getResultIcon(result: GlobalSearchResult): string {
  if (result.kind === "folder") return "i-lucide-folder";
  return getMimeIcon(result.mimeType ?? "application/octet-stream");
}

const failedThumbnails = reactive(new Set<string>());

function getThumbnailFileId(result: GlobalSearchResult): string | null {
  if (result.kind !== "file" || failedThumbnails.has(result.id)) return null;
  const mime = result.mimeType ?? "";
  if (mime.startsWith("image/")) return result.id;
  if (mime.startsWith("video/") && result.thumbnailFileId) return result.thumbnailFileId;
  return null;
}

const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);
const previewFiles = computed<LibraryFile[]>(() => (previewFile.value ? [previewFile.value] : []));

async function openPreview(result: GlobalSearchResult) {
  if (result.kind !== "file") return;
  try {
    const file = await api.files.get(result.libraryId, result.id);
    previewFile.value = file;
    previewOpen.value = true;
  } catch {
    // silent
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-6 overflow-y-auto flex-1 min-h-0 px-0.5">
    <UCard>
      <div class="space-y-4">
        <div class="space-y-1">
          <h1 class="text-xl font-semibold text-highlighted">Global Search</h1>
          <p class="text-sm text-muted">
            Search files and folders across every library you can access.
          </p>
        </div>

        <form
          class="flex flex-col gap-3 md:flex-row md:items-center"
          @submit.prevent="submitSearch"
        >
          <UInput
            v-model="searchInput"
            type="search"
            placeholder="Search all libraries…"
            icon="i-lucide-search"
            size="lg"
            class="w-full"
            :ui="{ root: 'w-full' }"
          />
          <UButton type="submit" color="primary" size="lg" icon="i-lucide-search"> Search </UButton>
        </form>

        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <UBadge color="neutral" variant="subtle" size="sm">
            {{ searchData?.totalCount ?? 0 }} total matches
          </UBadge>
          <UBadge color="neutral" variant="subtle" size="sm">{{ results.length }} shown</UBadge>
          <span v-if="(searchData?.totalCount ?? 0) > results.length">
            Showing the top {{ results.length }} most relevant results.
          </span>
        </div>
      </div>
    </UCard>

    <UAlert
      v-if="activeQuery.length < MIN_QUERY_LENGTH"
      color="info"
      variant="soft"
      icon="i-lucide-search-check"
      :description="`Enter at least ${MIN_QUERY_LENGTH} characters to start searching.`"
    />

    <div v-else-if="status === 'pending'" class="flex items-center justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-alert-circle"
      title="Search failed"
      description="Try again in a moment."
    />

    <UAlert
      v-else-if="!results.length"
      color="neutral"
      variant="soft"
      icon="i-lucide-folder-search"
      :description="`No results found for “${activeQuery}”.`"
    />

    <div v-else class="space-y-4">
      <AppPanel
        v-for="group in groupedResults"
        :key="group.libraryId"
        :title="group.libraryName"
        icon="i-lucide-library"
        body-class="p-1"
      >
        <template #actions>
          <UBadge color="neutral" variant="subtle" size="sm">
            {{ group.results.length }}
          </UBadge>
        </template>

        <div class="space-y-1">
          <div
            v-for="result in group.results"
            :key="`${result.kind}-${result.id}`"
            class="group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-elevated/70"
            :class="result.kind === 'file' ? 'cursor-pointer' : ''"
            @dblclick="openPreview(result)"
          >
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated overflow-hidden"
            >
              <AlcovesImage
                v-if="getThumbnailFileId(result)"
                :library-id="result.libraryId"
                :file-id="getThumbnailFileId(result)!"
                :alt="result.name"
                :width="80"
                :height="80"
                format="jpeg"
                :quality="70"
                class="size-full object-cover"
                @error="failedThumbnails.add(result.id)"
              />
              <UIcon v-else :name="getResultIcon(result)" class="size-4 text-primary" />
            </div>

            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ result.name }}</p>
              <p class="truncate font-mono text-[11px] text-muted">{{ result.locationPath }}</p>
              <p
                v-if="result.matchedLabels?.length"
                class="truncate text-[11px] text-primary md:hidden"
              >
                contains: {{ result.matchedLabels.join(", ") }}
              </p>
            </div>

            <div class="hidden shrink-0 items-center gap-2 md:flex">
              <UBadge v-if="result.matchedLabels?.length" color="primary" variant="soft" size="sm">
                contains: {{ result.matchedLabels.join(", ") }}
              </UBadge>
              <span class="text-xs text-muted">{{ formatDate(result.updatedAt) }}</span>
              <UBadge color="neutral" variant="soft" size="sm">{{ result.kind }}</UBadge>
              <UBadge
                v-if="result.kind === 'file' && typeof result.size === 'number'"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ formatFileSize(result.size) }}
              </UBadge>
            </div>
          </div>
        </div>
      </AppPanel>
    </div>

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="previewFile.libraryId"
      :files="previewFiles"
      @navigate="previewFile = $event"
    />
  </div>
</template>
