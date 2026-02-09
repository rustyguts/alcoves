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

export function useLibraryExplorer() {
  const route = useRoute();
  const libraryId = computed(() => route.params.id as string);
  const { user } = useAuth();

  const { data: library, refresh: refreshLibrary } = useFetch<Library>(
    () => `/api/libraries/${libraryId.value}`,
  );
  const { data: libraryUsers, refresh: refreshLibraryUsers } = useFetch<LibraryUsersResponse>(
    () => `/api/libraries/${libraryId.value}/users`,
  );

  const viewMode = ref<"files" | "tags" | "trash" | "users">("files");
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
    return navigateTo({
      path: route.path,
      query: buildFolderQuery(folderId),
    });
  }

  const ssrHeaders = import.meta.server ? useRequestHeaders(["cookie"]) : undefined;
  const { data: initData } = useAsyncData(
    `library-init-${libraryId.value}-${currentFolderId.value ?? "root"}`,
    async () => {
      const filesQuery: Record<string, string> = {};
      if (currentFolderId.value) filesQuery.folder = currentFolderId.value;

      const [result, trashedResult, tags] = await Promise.all([
        $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
          query: filesQuery,
          headers: ssrHeaders,
        }),
        $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
          query: { trashed: "true", limit: "1" },
          headers: ssrHeaders,
        }),
        $fetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`, {
          headers: ssrHeaders,
        }),
      ]);
      return { result, trashedCount: trashedResult.totalCount, tags };
    },
    { watch: [libraryId, currentFolderId] },
  );

  const entries = ref<LibraryEntry[]>(initData.value?.result.entries ?? []);
  const breadcrumbs = ref<FolderBreadcrumb[]>(initData.value?.result.breadcrumbs ?? []);
  const nextCursor = ref<string | null>(initData.value?.result.nextCursor ?? null);
  const totalCount = ref(initData.value?.result.totalCount ?? 0);
  const trashedCount = ref(initData.value?.trashedCount ?? 0);
  const libraryTags = ref<LibraryTag[]>(initData.value?.tags ?? []);
  const loadingMore = ref(false);
  const filesPending = ref(!initData.value);

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
    return $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, { query });
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
    } finally {
      filesPending.value = false;
    }
  }

  async function refreshTags() {
    libraryTags.value = await $fetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`);
  }

  async function refreshTrashedCount() {
    const result = await $fetch<PaginatedFiles>(`/api/libraries/${libraryId.value}/files`, {
      query: { trashed: "true", limit: "1" },
    });
    trashedCount.value = result.totalCount;
  }

  async function refreshFolders(): Promise<LibraryFolder[]> {
    return $fetch<LibraryFolder[]>(`/api/libraries/${libraryId.value}/folders`);
  }

  watchEffect(() => {
    if (!initData.value) return;
    entries.value = initData.value.result.entries;
    breadcrumbs.value = initData.value.result.breadcrumbs;
    nextCursor.value = initData.value.result.nextCursor;
    totalCount.value = initData.value.result.totalCount;
    trashedCount.value = initData.value.trashedCount;
    libraryTags.value = initData.value.tags;
    filesPending.value = false;
  });

  return {
    route,
    libraryId,
    user,
    library,
    refreshLibrary,
    libraryUsers,
    refreshLibraryUsers,
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
