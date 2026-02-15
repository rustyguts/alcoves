<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import type { GlobalSearchResponse, GlobalSearchResult } from "~~/shared/types/api";
import { formatDate, formatFileSize, getMimeIcon } from "~/utils/mime-icons";
import { useApiFetch } from "~/composables/useApiFetch";

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

function getResultLink(result: GlobalSearchResult) {
  if (result.targetFolderId) {
    return {
      path: `/libraries/${result.libraryId}`,
      query: { folder: result.targetFolderId },
    };
  }

  return {
    path: `/libraries/${result.libraryId}`,
  };
}

function getResultIcon(result: GlobalSearchResult): string {
  if (result.kind === "folder") return "i-lucide-folder";
  return getMimeIcon(result.mimeType ?? "application/octet-stream");
}
</script>

<template>
  <div class="mx-auto w-full max-w-6xl space-y-6">
    <UCard
      variant="subtle"
      :ui="{
        root: 'overflow-hidden bg-gradient-to-br from-primary/10 via-elevated to-default shadow-sm',
        body: 'space-y-4',
      }"
    >
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold">Global Search</h1>
        <p class="text-sm text-muted">
          Search files and folders across every library you can access.
        </p>
      </div>

      <form class="flex flex-col gap-3 md:flex-row md:items-center" @submit.prevent="submitSearch">
        <UInput
          v-model="searchInput"
          type="search"
          leading-icon="i-lucide-search"
          placeholder="Search all libraries..."
          autocomplete="off"
          enterkeyhint="search"
          class="w-full"
          :ui="{
            root: 'rounded-xl',
          }"
        />
        <UButton type="submit" icon="i-lucide-search" label="Search" />
      </form>

      <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
        <UBadge color="neutral" variant="subtle"
          >{{ searchData?.totalCount ?? 0 }} total matches</UBadge
        >
        <UBadge color="neutral" variant="subtle">{{ results.length }} shown</UBadge>
        <span v-if="(searchData?.totalCount ?? 0) > results.length">
          Showing the top {{ results.length }} most relevant results.
        </span>
      </div>
    </UCard>

    <UCard v-if="activeQuery.length < MIN_QUERY_LENGTH" variant="soft">
      <div class="flex items-center gap-3 text-muted">
        <UIcon name="i-lucide-search-check" class="size-5" />
        <p>Enter at least {{ MIN_QUERY_LENGTH }} characters to start searching.</p>
      </div>
    </UCard>

    <div v-else-if="status === 'pending'" class="flex items-center justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </div>

    <UCard v-else-if="error" variant="soft">
      <div class="flex items-center gap-3 text-error">
        <UIcon name="i-lucide-alert-circle" class="size-5" />
        <p>Search failed. Try again in a moment.</p>
      </div>
    </UCard>

    <UCard v-else-if="!results.length" variant="soft">
      <div class="flex items-center gap-3 text-muted">
        <UIcon name="i-lucide-folder-search" class="size-5" />
        <p>No results found for "{{ activeQuery }}".</p>
      </div>
    </UCard>

    <div v-else class="space-y-4">
      <UCard
        v-for="group in groupedResults"
        :key="group.libraryId"
        variant="soft"
        :ui="{
          body: 'p-0',
        }"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-library" class="size-4 text-primary" />
              <h2 class="font-semibold">{{ group.libraryName }}</h2>
            </div>
            <UBadge color="neutral" variant="subtle">{{ group.results.length }}</UBadge>
          </div>
        </template>

        <div class="space-y-1 p-1">
          <RouterLink
            v-for="result in group.results"
            :key="`${result.kind}-${result.id}`"
            :to="getResultLink(result)"
            class="group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-elevated/70"
          >
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated/80"
            >
              <UIcon :name="getResultIcon(result)" class="size-4 text-primary" />
            </div>

            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ result.name }}</p>
              <p class="truncate font-mono text-[11px] text-muted">{{ result.locationPath }}</p>
            </div>

            <div class="hidden shrink-0 items-center gap-2 md:flex">
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

            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-4 shrink-0 text-muted transition-colors group-hover:text-primary"
            />
          </RouterLink>
        </div>
      </UCard>
    </div>
  </div>
</template>
