<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import type { GlobalSearchResponse, GlobalSearchResult, LibraryFile } from "~~/shared/types/api";
import { formatDate, formatFileSize, getMimeIcon } from "~/utils/mime-icons";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import AppIcon from "~/components/AppIcon.vue";
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
  return {
    query,
    totalCount: 0,
    results: [],
  };
}

const {
  data: searchData,
  status,
  error,
  execute,
} = useApiFetch<GlobalSearchResponse>("/api/search", {
  query: computed(() => ({
    q: activeQuery.value,
    limit: String(SEARCH_LIMIT),
  })),
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
    {
      libraryId: string;
      libraryName: string;
      results: GlobalSearchResult[];
    }
  >();

  for (const result of results.value) {
    let group = byLibraryId.get(result.libraryId);
    if (!group) {
      group = {
        libraryId: result.libraryId,
        libraryName: result.libraryName,
        results: [],
      };
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

const failedThumbnails = new Set<string>();

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
    // silently fail
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-6 overflow-y-auto flex-1 min-h-0">
    <div
      class="card bg-gradient-to-br from-primary/10 via-elevated to-base-100 shadow-sm overflow-hidden"
    >
      <div class="card-body space-y-4">
        <div class="space-y-1">
          <h1 class="text-2xl font-semibold">Global Search</h1>
          <p class="text-sm text-muted">
            Search files and folders across every library you can access.
          </p>
        </div>

        <form
          class="flex flex-col gap-3 md:flex-row md:items-center"
          @submit.prevent="submitSearch"
        >
          <div class="relative w-full">
            <AppIcon
              name="i-lucide-search"
              class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none"
            />
            <input
              v-model="searchInput"
              type="search"
              placeholder="Search all libraries..."
              autocomplete="off"
              enterkeyhint="search"
              class="input w-full pl-10 rounded-xl"
            />
          </div>
          <button type="submit" class="btn btn-soft btn-primary">
            <AppIcon name="i-lucide-search" class="size-4" />
            Search
          </button>
        </form>

        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span class="badge badge-ghost badge-sm"
            >{{ searchData?.totalCount ?? 0 }} total matches</span
          >
          <span class="badge badge-ghost badge-sm">{{ results.length }} shown</span>
          <span v-if="(searchData?.totalCount ?? 0) > results.length">
            Showing the top {{ results.length }} most relevant results.
          </span>
        </div>
      </div>
    </div>

    <div v-if="activeQuery.length < MIN_QUERY_LENGTH" class="card bg-base-100">
      <div class="card-body">
        <div class="flex items-center gap-3 text-muted">
          <AppIcon name="i-lucide-search-check" class="size-5" />
          <p>Enter at least {{ MIN_QUERY_LENGTH }} characters to start searching.</p>
        </div>
      </div>
    </div>

    <div v-else-if="status === 'pending'" class="flex items-center justify-center py-12">
      <AppIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </div>

    <div v-else-if="error" class="card bg-base-100">
      <div class="card-body">
        <div class="flex items-center gap-3 text-error">
          <AppIcon name="i-lucide-alert-circle" class="size-5" />
          <p>Search failed. Try again in a moment.</p>
        </div>
      </div>
    </div>

    <div v-else-if="!results.length" class="card bg-base-100">
      <div class="card-body">
        <div class="flex items-center gap-3 text-muted">
          <AppIcon name="i-lucide-folder-search" class="size-5" />
          <p>No results found for "{{ activeQuery }}".</p>
        </div>
      </div>
    </div>

    <div v-else class="space-y-4">
      <div v-for="group in groupedResults" :key="group.libraryId" class="card bg-base-100">
        <div class="flex items-center justify-between px-6 pt-5 pb-2">
          <div class="flex items-center gap-2">
            <AppIcon name="i-lucide-library" class="size-4 text-primary" />
            <h2 class="font-semibold">{{ group.libraryName }}</h2>
          </div>
          <span class="badge badge-ghost badge-sm">{{ group.results.length }}</span>
        </div>

        <div class="space-y-1 p-1">
          <div
            v-for="result in group.results"
            :key="`${result.kind}-${result.id}`"
            class="group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-elevated/70"
            :class="result.kind === 'file' ? 'cursor-pointer' : ''"
            @dblclick="openPreview(result)"
          >
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated/80 overflow-hidden"
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
              <AppIcon v-else :name="getResultIcon(result)" class="size-4 text-primary" />
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
              <span
                v-if="result.matchedLabels?.length"
                class="badge badge-soft badge-primary badge-sm"
              >
                contains: {{ result.matchedLabels.join(", ") }}
              </span>
              <span class="text-xs text-muted">{{ formatDate(result.updatedAt) }}</span>
              <span class="badge badge-soft badge-neutral badge-sm">{{ result.kind }}</span>
              <span
                v-if="result.kind === 'file' && typeof result.size === 'number'"
                class="badge badge-ghost badge-sm"
              >
                {{ formatFileSize(result.size) }}
              </span>
            </div>
          </div>
        </div>
      </div>
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
