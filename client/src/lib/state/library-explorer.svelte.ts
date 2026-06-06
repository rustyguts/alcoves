import { api } from '$lib/api';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type {
	AuthUser,
	FolderBreadcrumb,
	Library,
	LibraryEntry,
	LibraryFile,
	LibraryFolder,
	LibraryTag,
	LibraryUsersResponse,
	PaginatedFiles
} from '$lib/types/api';

type ViewMode = 'files' | 'trash' | 'tags' | 'users';
type EntryViewMode = 'file' | 'card';

interface CachedViewState {
	entries: LibraryEntry[];
	breadcrumbs: FolderBreadcrumb[];
	nextCursor: string | null;
	totalCount: number;
	loaded: boolean;
}

/**
 * Library explorer store — folder browsing, view modes, trash flag, selection,
 * and paginated entry loading for a single library.
 *
 * Ported from the Nuxt `useLibraryExplorer` composable. That version was route
 * coupled (`useRoute`/`useRouter`); here the route-derived inputs are passed as
 * GETTER functions so the store stays test-friendly and the consuming page wires
 * them from `page.params`/`page.url`:
 *   - `getLibraryId()`       — current library id (route param)
 *   - `getCurrentFolderId()` — `?folder=` query value (null at the library root)
 *   - `getIsTrashRoute()`    — whether the path ends in `/trash`
 *   - `getUser()`            — the logged-in user (from the auth store)
 *
 * `library` and `libraryUsers` are owned here (the Vue version used `useApiFetch`)
 * and refreshed via `refreshLibrary()`/`refreshLibraryUsers()`. State is exposed
 * via getters so reactivity survives the function boundary. No `$effect`/`watch`
 * inside the store: the page calls `fetchInitialData()` from its own `$effect`
 * whenever the library id or folder changes, and `openFolder()` returns the next
 * query so the page can drive navigation.
 */
export function createLibraryExplorer(
	getLibraryId: () => string,
	getCurrentFolderId: () => string | null = () => null,
	getIsTrashRoute: () => boolean = () => false,
	getUser: () => AuthUser | null = () => null
) {
	let library = $state<Library | null>(null);
	let libraryUsers = $state<LibraryUsersResponse | null>(null);

	let viewMode = $state<ViewMode>(getIsTrashRoute() ? 'trash' : 'files');
	let entryViewMode = $state<EntryViewMode>('file');

	const showTrashed = $derived(viewMode === 'trash');
	const showTags = $derived(viewMode === 'tags');
	const showUsers = $derived(viewMode === 'users');

	const canManageUsers = $derived(Boolean(libraryUsers?.canManageUsers) && !library?.isDefault);
	const canManageLibrary = $derived.by(() => {
		const user = getUser();
		if (library?.ownerId && user?.id && library.ownerId === user.id) {
			return true;
		}
		const membership = libraryUsers?.members.find((member) => member.userId === user?.id);
		return membership?.role === 'owner' || membership?.role === 'admin';
	});

	let entries = $state<LibraryEntry[]>([]);
	let breadcrumbs = $state<FolderBreadcrumb[]>([]);
	let nextCursor = $state<string | null>(null);
	let totalCount = $state(0);
	let trashedCount = $state(0);
	let libraryTags = $state<LibraryTag[]>([]);
	let loadingMore = $state(false);
	let filesPending = $state(true);

	const viewCache = new SvelteMap<string, CachedViewState>();

	const files = $derived(entries.filter((entry): entry is LibraryFile => entry.kind === 'file'));
	const folders = $derived(
		entries.filter((entry): entry is LibraryFolder => entry.kind === 'folder')
	);

	const selectedFiles = new SvelteSet<string>();
	const selectedFolders = new SvelteSet<string>();
	// Single anchor index into the unified `entries` list, shared across files and folders.
	let lastClickedIndex = $state<number | null>(null);

	function getViewCacheKey(trashed: boolean, folderId: string | null): string {
		const lib = getLibraryId();
		if (trashed) return `${lib}:trash`;
		return `${lib}:files:${folderId ?? '__root__'}`;
	}

	function upsertViewCache(key: string, state: Omit<CachedViewState, 'loaded'>) {
		viewCache.set(key, {
			entries: state.entries,
			breadcrumbs: state.breadcrumbs,
			nextCursor: state.nextCursor,
			totalCount: state.totalCount,
			loaded: true
		});
	}

	function restoreViewFromCache(key: string): boolean {
		const cached = viewCache.get(key);
		if (!cached?.loaded) return false;
		entries = [...cached.entries];
		breadcrumbs = [...cached.breadcrumbs];
		nextCursor = cached.nextCursor;
		totalCount = cached.totalCount;
		return true;
	}

	function cacheCurrentViewState() {
		const key = getViewCacheKey(showTrashed, getCurrentFolderId());
		upsertViewCache(key, {
			entries: [...entries],
			breadcrumbs: [...breadcrumbs],
			nextCursor,
			totalCount
		});
	}

	/** Compute the next route query for navigating to a folder (null → root). */
	function buildFolderQuery(
		folderId: string | null,
		current: Record<string, string> = {}
	): Record<string, string> {
		const query = { ...current };
		delete query.folder;
		if (folderId) {
			query.folder = folderId;
		}
		return query;
	}

	function clearSelection(resetAnchor = false) {
		selectedFiles.clear();
		selectedFolders.clear();
		if (resetAnchor) {
			lastClickedIndex = null;
		}
	}

	function isEntrySelected(entry: LibraryEntry): boolean {
		return entry.kind === 'file' ? selectedFiles.has(entry.id) : selectedFolders.has(entry.id);
	}

	async function fetchPage(cursor?: string): Promise<PaginatedFiles> {
		const query: Record<string, string> = {};
		if (showTrashed) {
			query.trashed = 'true';
		} else {
			const folderId = getCurrentFolderId();
			if (folderId) query.folder = folderId;
		}
		if (cursor) query.cursor = cursor;
		return api.files.list(getLibraryId(), query);
	}

	async function loadMore() {
		if (loadingMore || !nextCursor) return;
		loadingMore = true;
		try {
			const result = await fetchPage(nextCursor);
			entries = [...entries, ...result.entries];
			nextCursor = result.nextCursor;
			totalCount = result.totalCount;
			breadcrumbs = result.breadcrumbs;
			cacheCurrentViewState();
		} finally {
			loadingMore = false;
		}
	}

	async function resetAndFetch(options?: { preserveEntries?: boolean; silent?: boolean }) {
		const preserveEntries = options?.preserveEntries ?? false;
		// silent: keep existing entries visible, skip loading state — new items just pop in
		const silent = options?.silent ?? false;
		const currentViewKey = getViewCacheKey(showTrashed, getCurrentFolderId());

		if (!silent) {
			filesPending = true;
		}
		clearSelection(true);

		if (!silent) {
			if (preserveEntries) {
				const restored = restoreViewFromCache(currentViewKey);
				if (!restored) {
					entries = [];
					breadcrumbs = [];
					nextCursor = null;
					totalCount = 0;
				}
			} else {
				entries = [];
				breadcrumbs = [];
				nextCursor = null;
				totalCount = 0;
			}

			if (!preserveEntries) {
				viewCache.delete(currentViewKey);
			}
		}

		try {
			const result = await fetchPage();
			entries = result.entries;
			breadcrumbs = result.breadcrumbs;
			nextCursor = result.nextCursor;
			totalCount = result.totalCount;
			upsertViewCache(currentViewKey, {
				entries: [...result.entries],
				breadcrumbs: [...result.breadcrumbs],
				nextCursor: result.nextCursor,
				totalCount: result.totalCount
			});
			if (showTrashed) {
				trashedCount = result.totalCount;
			}
		} catch (error) {
			console.error('Failed to fetch library files:', error);
		} finally {
			if (!silent) {
				filesPending = false;
			}
		}
	}

	async function refreshLibrary() {
		library = await api.libraries.get(getLibraryId());
	}

	async function refreshLibraryUsers() {
		libraryUsers = await api.members.list(getLibraryId());
	}

	async function refreshTags() {
		libraryTags = await api.tags.list(getLibraryId());
	}

	async function refreshTrashedCount() {
		const result = await api.files.list(getLibraryId(), { trashed: 'true', limit: '1' });
		trashedCount = result.totalCount;
	}

	async function refreshFolders(): Promise<LibraryFolder[]> {
		return api.folders.list(getLibraryId());
	}

	// Initial data load — the page calls this from an $effect on libraryId/folder change.
	async function fetchInitialData() {
		filesPending = true;
		try {
			const filesQuery: Record<string, string> = {};
			if (showTrashed) {
				filesQuery.trashed = 'true';
			} else {
				const folderId = getCurrentFolderId();
				if (folderId) filesQuery.folder = folderId;
			}

			const [result, trashedResult, tags] = await Promise.all([
				api.files.list(getLibraryId(), filesQuery),
				api.files.list(getLibraryId(), { trashed: 'true', limit: '1' }),
				api.tags.list(getLibraryId())
			]);

			entries = result.entries;
			breadcrumbs = result.breadcrumbs;
			nextCursor = result.nextCursor;
			totalCount = result.totalCount;
			const currentViewKey = getViewCacheKey(showTrashed, getCurrentFolderId());
			upsertViewCache(currentViewKey, {
				entries: [...result.entries],
				breadcrumbs: [...result.breadcrumbs],
				nextCursor: result.nextCursor,
				totalCount: result.totalCount
			});
			trashedCount = trashedResult.totalCount;
			libraryTags = tags;
		} catch (error) {
			console.error('Failed to fetch library data:', error);
			// Reset to empty state on error
			entries = [];
			breadcrumbs = [];
			nextCursor = null;
			totalCount = 0;
			trashedCount = 0;
			libraryTags = [];
		} finally {
			filesPending = false;
		}
	}

	return {
		get library() {
			return library;
		},
		get libraryUsers() {
			return libraryUsers;
		},
		get viewMode() {
			return viewMode;
		},
		set viewMode(value: ViewMode) {
			viewMode = value;
		},
		get entryViewMode() {
			return entryViewMode;
		},
		set entryViewMode(value: EntryViewMode) {
			entryViewMode = value;
		},
		get showTrashed() {
			return showTrashed;
		},
		get showTags() {
			return showTags;
		},
		get showUsers() {
			return showUsers;
		},
		get canManageUsers() {
			return canManageUsers;
		},
		get canManageLibrary() {
			return canManageLibrary;
		},
		get entries() {
			return entries;
		},
		set entries(value: LibraryEntry[]) {
			entries = value;
		},
		get breadcrumbs() {
			return breadcrumbs;
		},
		set breadcrumbs(value: FolderBreadcrumb[]) {
			breadcrumbs = value;
		},
		get nextCursor() {
			return nextCursor;
		},
		set nextCursor(value: string | null) {
			nextCursor = value;
		},
		get totalCount() {
			return totalCount;
		},
		set totalCount(value: number) {
			totalCount = value;
		},
		get trashedCount() {
			return trashedCount;
		},
		set trashedCount(value: number) {
			trashedCount = value;
		},
		get libraryTags() {
			return libraryTags;
		},
		set libraryTags(value: LibraryTag[]) {
			libraryTags = value;
		},
		get loadingMore() {
			return loadingMore;
		},
		set loadingMore(value: boolean) {
			loadingMore = value;
		},
		get filesPending() {
			return filesPending;
		},
		set filesPending(value: boolean) {
			filesPending = value;
		},
		get files() {
			return files;
		},
		get folders() {
			return folders;
		},
		get selectedFiles() {
			return selectedFiles;
		},
		get selectedFolders() {
			return selectedFolders;
		},
		get lastClickedIndex() {
			return lastClickedIndex;
		},
		set lastClickedIndex(value: number | null) {
			lastClickedIndex = value;
		},
		buildFolderQuery,
		clearSelection,
		isEntrySelected,
		fetchPage,
		loadMore,
		resetAndFetch,
		refreshLibrary,
		refreshLibraryUsers,
		refreshTags,
		refreshTrashedCount,
		refreshFolders,
		fetchInitialData
	};
}
