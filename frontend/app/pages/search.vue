<script setup lang="ts">
import type { GlobalSearchResponse, GlobalSearchResult, LibraryFile } from "~~/shared/types/api";

definePageMeta({ layout: "dashboard" });
import type { GalleryGroup } from "~/utils/gallery-types";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import FilePreview from "~/components/FilePreview.vue";
import JustifiedGallery from "~/components/JustifiedGallery.vue";

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

function isVideoResult(result: GlobalSearchResult): boolean {
  return (result.mimeType ?? "").startsWith("video/");
}

// Thumbnail source: the file itself for images, the generated poster for videos,
// null (→ icon tile) for folders and non-media files.
function getThumbnailFileId(result: GlobalSearchResult): string | null {
  if (result.kind !== "file") return null;
  const mime = result.mimeType ?? "";
  if (mime.startsWith("image/")) return result.id;
  if (mime.startsWith("video/") && result.thumbnailFileId) return result.thumbnailFileId;
  return null;
}

function aspectOf(result: GlobalSearchResult): number {
  if (result.width && result.height && result.width > 0 && result.height > 0) {
    return result.width / result.height;
  }
  // Folders read as wide tiles; everything else falls back to square.
  return result.kind === "folder" ? 1.6 : 1;
}

// Group results by library, mapped into the shared gallery shape. The library
// name is the sticky heading; matched object labels become a tile badge.
const galleryGroups = computed<GalleryGroup<GlobalSearchResult>[]>(() => {
  const groups: GalleryGroup<GlobalSearchResult>[] = [];
  const byLibraryId = new Map<string, GalleryGroup<GlobalSearchResult>>();

  for (const result of results.value) {
    let group = byLibraryId.get(result.libraryId);
    if (!group) {
      group = { key: result.libraryId, heading: result.libraryName, count: 0, items: [] };
      byLibraryId.set(result.libraryId, group);
      groups.push(group);
    }
    group.items.push({
      id: `${result.kind}-${result.id}`,
      libraryId: result.libraryId,
      thumbnailFileId: getThumbnailFileId(result),
      aspect: aspectOf(result),
      mime:
        result.kind === "folder" ? "inode/directory" : (result.mimeType ?? "application/octet-stream"),
      name: result.name,
      isVideo: isVideoResult(result),
      sourceWidth: result.width,
      sourceHeight: result.height,
      badge: result.matchedLabels?.length ? result.matchedLabels.join(", ") : null,
      raw: result,
    });
    group.count = group.items.length;
  }

  return groups;
});

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
            icon="i-lineicons-search"
            size="lg"
            class="w-full"
            :ui="{ root: 'w-full' }"
          />
          <UButton type="submit" color="primary" size="lg" icon="i-lineicons-search"> Search </UButton>
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
      icon="i-lineicons-search-1"
      :description="`Enter at least ${MIN_QUERY_LENGTH} characters to start searching.`"
    />

    <div v-else-if="status === 'pending'" class="flex items-center justify-center py-12">
      <UIcon name="i-lineicons-spinner-solid" class="size-6 animate-spin text-muted" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-lineicons-warning"
      title="Search failed"
      description="Try again in a moment."
    />

    <UAlert
      v-else-if="!results.length"
      color="neutral"
      variant="soft"
      icon="i-lineicons-folder"
      :description="`No results found for “${activeQuery}”.`"
    />

    <div v-else>
      <JustifiedGallery :groups="galleryGroups" @select="openPreview" />
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
