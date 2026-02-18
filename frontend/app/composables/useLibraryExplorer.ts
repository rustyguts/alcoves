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
import { apiFetch } from "~/utils/api-fetch";

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

  const files = computed(() =>
    entries.value.filter((entry): entry is LibraryFile => entry.kind === "file"),
  );
  const folders = computed(() =>
    entries.value.filter((entry): entry is LibraryFolder => entry.kind === "folder"),
  );

  const selectedFiles = reactive(new Set<string>());
  const selectedFolders = reactive(new Set<string>());
  const lastClickedFileIndex = ref<number | null>(null);
  const lastClickedFolderIndex = ref<number | null>(null);

  function clearSelection(resetAnchors = false) {
    selectedFiles.clear();
    selectedFolders.clear();
    if (resetAnchors) {
      lastClickedFileIndex.value = null;
      lastClickedFolderIndex.value = null;
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
    return apiFetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, { query });
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
    } finally {
      loadingMore.value = false;
    }
  }

  async function resetAndFetch() {
    filesPending.value = true;
    entries.value = [];
    nextCursor.value = null;
    clearSelection(true);
    try {
      const result = await fetchPage();
      entries.value = result.entries;
      breadcrumbs.value = result.breadcrumbs;
      nextCursor.value = result.nextCursor;
      totalCount.value = result.totalCount;
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
    libraryTags.value = await apiFetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`);
  }

  async function refreshTrashedCount() {
    const result = await apiFetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
      query: { trashed: "true", limit: "1" },
    });
    trashedCount.value = result.totalCount;
  }

  async function refreshFolders(): Promise<LibraryFolder[]> {
    return apiFetch<LibraryFolder[]>(`/api/libraries/${libraryId.value}/folders`);
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
        apiFetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, { query: filesQuery }),
        apiFetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
          query: { trashed: "true", limit: "1" },
        }),
        apiFetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`),
      ]);

      entries.value = result.entries;
      breadcrumbs.value = result.breadcrumbs;
      nextCursor.value = result.nextCursor;
      totalCount.value = result.totalCount;
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

  watch([libraryId, currentFolderId], () => {
    fetchInitialData();
  }, { immediate: true });

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
    lastClickedFileIndex,
    lastClickedFolderIndex,
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
