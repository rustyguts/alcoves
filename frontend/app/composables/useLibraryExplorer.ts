import { useRoute, useRouter } from "vue-router";
import type {
  FolderBreadcrumb,
  Library,
  LibraryEntry,
  LibraryFile,
  LibraryFolder,
  LibraryTag,
  LibraryUsersResponse,
  PaginatedFiles,
} from "~~/shared/types/api";
import { useApiFetch } from "~/composables/useApiFetch";
import { useAuth } from "~/composables/useAuth";
import { api } from "~/api";

export function useLibraryExplorer() {
  const route = useRoute();
  const router = useRouter();
  const libraryId = computed(() => route.params.id as string);
  const { user } = useAuth();

  const { data: library, refresh: refreshLibrary } = useApiFetch<Library>(
    () => `/api/libraries/${libraryId.value}`,
  );
  const { data: libraryUsers, refresh: refreshLibraryUsers } = useApiFetch<LibraryUsersResponse>(
    () => `/api/libraries/${libraryId.value}/users`,
  );

  const isTrashRoute = computed(() => route.path.endsWith("/trash"));
  const viewMode = ref<"files" | "trash" | "tags" | "users">(
    isTrashRoute.value ? "trash" : "files",
  );
  const entryViewMode = ref<"file" | "card">("file");
  const showTrashed = computed(() => viewMode.value === "trash");
  const showTags = computed(() => viewMode.value === "tags");
  const showUsers = computed(() => viewMode.value === "users");
  const canManageUsers = computed(
    () => Boolean(libraryUsers.value?.canManageUsers) && !library.value?.isDefault,
  );
  const canManageLibrary = computed(() => {
    if (library.value?.ownerId && user.value?.id && library.value.ownerId === user.value.id) {
      return true;
    }

    const membership = libraryUsers.value?.members.find(
      (member) => member.userId === user.value?.id,
    );
    return membership?.role === "owner" || membership?.role === "admin";
  });

  const currentFolderId = computed(() => {
    const raw = route.query.folder;
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    return value || null;
  });

  function buildFolderQuery(folderId: string | null) {
    const query = { ...route.query };
    delete query.folder;
    if (folderId) {
      query.folder = folderId;
    }
    return query;
  }

  function openFolder(folderId: string | null) {
    return router.push({
      path: route.path,
      query: buildFolderQuery(folderId),
    });
  }

  const entries = ref<LibraryEntry[]>([]);
  const breadcrumbs = ref<FolderBreadcrumb[]>([]);
  const nextCursor = ref<string | null>(null);
  const totalCount = ref(0);
  const trashedCount = ref(0);
  const libraryTags = ref<LibraryTag[]>([]);
  const loadingMore = ref(false);
  const filesPending = ref(true);

  interface CachedViewState {
    entries: LibraryEntry[];
    breadcrumbs: FolderBreadcrumb[];
    nextCursor: string | null;
    totalCount: number;
    loaded: boolean;
  }

  const viewCache = reactive<Record<string, CachedViewState>>({});

  function getViewCacheKey(trashed: boolean, folderId: string | null): string {
    const lib = libraryId.value;
    if (trashed) return `${lib}:trash`;
    return `${lib}:files:${folderId ?? "__root__"}`;
  }

  function upsertViewCache(key: string, state: Omit<CachedViewState, "loaded">) {
    viewCache[key] = {
      entries: state.entries,
      breadcrumbs: state.breadcrumbs,
      nextCursor: state.nextCursor,
      totalCount: state.totalCount,
      loaded: true,
    };
  }

  function restoreViewFromCache(key: string): boolean {
    const cached = viewCache[key];
    if (!cached?.loaded) return false;
    entries.value = [...cached.entries];
    breadcrumbs.value = [...cached.breadcrumbs];
    nextCursor.value = cached.nextCursor;
    totalCount.value = cached.totalCount;
    return true;
  }

  function cacheCurrentViewState() {
    const key = getViewCacheKey(showTrashed.value, currentFolderId.value);
    upsertViewCache(key, {
      entries: [...entries.value],
      breadcrumbs: [...breadcrumbs.value],
      nextCursor: nextCursor.value,
      totalCount: totalCount.value,
    });
  }

  const files = computed(() =>
    entries.value.filter((entry): entry is LibraryFile => entry.kind === "file"),
  );
  const folders = computed(() =>
    entries.value.filter((entry): entry is LibraryFolder => entry.kind === "folder"),
  );

  const selectedFiles = reactive(new Set<string>());
  const selectedFolders = reactive(new Set<string>());
  // Single anchor index into the unified `entries` list, shared across files and folders.
  const lastClickedIndex = ref<number | null>(null);

  function clearSelection(resetAnchor = false) {
    selectedFiles.clear();
    selectedFolders.clear();
    if (resetAnchor) {
      lastClickedIndex.value = null;
    }
  }

  function isEntrySelected(entry: LibraryEntry): boolean {
    return entry.kind === "file" ? selectedFiles.has(entry.id) : selectedFolders.has(entry.id);
  }

  async function fetchPage(cursor?: string): Promise<PaginatedFiles> {
    const query: Record<string, string> = {};
    if (showTrashed.value) {
      query.trashed = "true";
    } else if (currentFolderId.value) {
      query.folder = currentFolderId.value;
    }
    if (cursor) query.cursor = cursor;
    return api.files.list(libraryId.value, query);
  }

  async function loadMore() {
    if (loadingMore.value || !nextCursor.value) return;
    loadingMore.value = true;
    try {
      const result = await fetchPage(nextCursor.value);
      entries.value.push(...result.entries);
      nextCursor.value = result.nextCursor;
      totalCount.value = result.totalCount;
      breadcrumbs.value = result.breadcrumbs;
      cacheCurrentViewState();
    } finally {
      loadingMore.value = false;
    }
  }

  async function resetAndFetch(options?: { preserveEntries?: boolean }) {
    const preserveEntries = options?.preserveEntries ?? false;
    const currentViewKey = getViewCacheKey(showTrashed.value, currentFolderId.value);
    filesPending.value = true;
    clearSelection(true);

    if (preserveEntries) {
      const restored = restoreViewFromCache(currentViewKey);
      if (!restored) {
        entries.value = [];
        breadcrumbs.value = [];
        nextCursor.value = null;
        totalCount.value = 0;
      }
    } else {
      entries.value = [];
      breadcrumbs.value = [];
      nextCursor.value = null;
      totalCount.value = 0;
    }

    if (!preserveEntries) {
      delete viewCache[currentViewKey];
    }

    try {
      const result = await fetchPage();
      entries.value = result.entries;
      breadcrumbs.value = result.breadcrumbs;
      nextCursor.value = result.nextCursor;
      totalCount.value = result.totalCount;
      upsertViewCache(currentViewKey, {
        entries: [...result.entries],
        breadcrumbs: [...result.breadcrumbs],
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
      });
      if (showTrashed.value) {
        trashedCount.value = result.totalCount;
      }
    } catch (error) {
      console.error("Failed to fetch library files:", error);
      // State is already reset above, just ensure pending is cleared
    } finally {
      filesPending.value = false;
    }
  }

  async function refreshTags() {
    libraryTags.value = await api.tags.list(libraryId.value);
  }

  async function refreshTrashedCount() {
    const result = await api.files.list(libraryId.value, { trashed: "true", limit: "1" });
    trashedCount.value = result.totalCount;
  }

  async function refreshFolders(): Promise<LibraryFolder[]> {
    return api.folders.list(libraryId.value);
  }

  // Initial data load + re-fetch on libraryId/folder changes
  async function fetchInitialData() {
    filesPending.value = true;
    try {
      const filesQuery: Record<string, string> = {};
      if (showTrashed.value) {
        filesQuery.trashed = "true";
      } else if (currentFolderId.value) {
        filesQuery.folder = currentFolderId.value;
      }

      const [result, trashedResult, tags] = await Promise.all([
        api.files.list(libraryId.value, filesQuery),
        api.files.list(libraryId.value, { trashed: "true", limit: "1" }),
        api.tags.list(libraryId.value),
      ]);

      entries.value = result.entries;
      breadcrumbs.value = result.breadcrumbs;
      nextCursor.value = result.nextCursor;
      totalCount.value = result.totalCount;
      const currentViewKey = getViewCacheKey(showTrashed.value, currentFolderId.value);
      upsertViewCache(currentViewKey, {
        entries: [...result.entries],
        breadcrumbs: [...result.breadcrumbs],
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
      });
      trashedCount.value = trashedResult.totalCount;
      libraryTags.value = tags;
    } catch (error) {
      console.error("Failed to fetch library data:", error);
      // Reset to empty state on error
      entries.value = [];
      breadcrumbs.value = [];
      nextCursor.value = null;
      totalCount.value = 0;
      trashedCount.value = 0;
      libraryTags.value = [];
    } finally {
      filesPending.value = false;
    }
  }

  watch(
    [libraryId, currentFolderId],
    () => {
      fetchInitialData();
    },
    { immediate: true },
  );

  return {
    route,
    libraryId,
    user,
    library,
    refreshLibrary,
    libraryUsers,
    refreshLibraryUsers,
    isTrashRoute,
    viewMode,
    entryViewMode,
    showTrashed,
    showTags,
    showUsers,
    canManageUsers,
    canManageLibrary,
    currentFolderId,
    buildFolderQuery,
    openFolder,
    entries,
    breadcrumbs,
    nextCursor,
    totalCount,
    trashedCount,
    libraryTags,
    loadingMore,
    filesPending,
    files,
    folders,
    selectedFiles,
    selectedFolders,
    lastClickedIndex,
    clearSelection,
    isEntrySelected,
    fetchPage,
    loadMore,
    resetAndFetch,
    refreshTags,
    refreshTrashedCount,
    refreshFolders,
  };
}
