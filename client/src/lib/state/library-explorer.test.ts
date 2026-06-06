import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
	AuthUser,
	LibraryEntry,
	LibraryFile,
	LibraryFolder,
	LibraryTag,
	LibraryUsersResponse,
	Library,
	PaginatedFiles
} from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	libraries: { get: vi.fn() },
	members: { list: vi.fn() },
	files: { list: vi.fn() },
	folders: { list: vi.fn() },
	tags: { list: vi.fn() }
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({
	toast: { add: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { createLibraryExplorer } from './library-explorer.svelte';

const USER: AuthUser = {
	id: 'user-1',
	email: 'u@example.com',
	displayName: 'User',
	avatarUrl: null,
	role: 'owner'
};

function makeFile(over: Partial<LibraryFile>): LibraryFile {
	return {
		id: 'f1',
		libraryId: 'lib-1',
		parentFolderId: null,
		name: 'test.txt',
		mimeType: 'text/plain',
		size: 100,
		kind: 'file',
		duration: null,
		width: null,
		height: null,
		proxyStatus: null,
		sourceFileId: null,
		originalCreatedAt: null,
		hash: null,
		trashedAt: null,
		createdAt: '2025-01-01',
		updatedAt: '2025-01-01',
		owner: null,
		tags: [],
		...over
	};
}

function makeFolder(over: Partial<LibraryFolder>): LibraryFolder {
	return {
		id: 'fo1',
		libraryId: 'lib-1',
		parentFolderId: null,
		name: 'docs',
		kind: 'folder',
		trashedAt: null,
		createdAt: '2025-01-01',
		updatedAt: '2025-01-01',
		owner: null,
		tags: [],
		...over
	};
}

function makeLibrary(over: Partial<Library>): Library {
	return {
		id: 'lib-1',
		name: 'Lib',
		emoji: null,
		isDefault: false,
		faceRecognitionEnabled: false,
		objectDetectionEnabled: false,
		sharingEnabled: false,
		ownerId: 'user-1',
		createdAt: '',
		updatedAt: '',
		...over
	};
}

function emptyPage(over: Partial<PaginatedFiles> = {}): PaginatedFiles {
	return {
		entries: [],
		nextCursor: null,
		totalCount: 0,
		breadcrumbs: [],
		currentFolderId: null,
		...over
	};
}

function makeUsers(over: Partial<LibraryUsersResponse>): LibraryUsersResponse {
	return {
		libraryId: 'lib-1',
		canManageUsers: false,
		members: [],
		inviteLinks: [],
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// fetchInitialData / fetchPage default payloads
	apiMock.files.list.mockResolvedValue(emptyPage());
	apiMock.tags.list.mockResolvedValue([]);
});

describe('createLibraryExplorer — view modes', () => {
	it('viewMode starts as files (non-trash route)', () => {
		const store = createLibraryExplorer(() => 'lib-1');
		expect(store.viewMode).toBe('files');
		expect(store.showTrashed).toBe(false);
		expect(store.showTags).toBe(false);
		expect(store.showUsers).toBe(false);
	});

	it('viewMode initializes to trash when the route is /trash', () => {
		const store = createLibraryExplorer(
			() => 'lib-1',
			() => null,
			() => true
		);
		expect(store.viewMode).toBe('trash');
		expect(store.showTrashed).toBe(true);
	});

	it('showTrashed/showTags/showUsers reflect viewMode', () => {
		const store = createLibraryExplorer(() => 'lib-1');

		store.viewMode = 'trash';
		expect(store.showTrashed).toBe(true);
		expect(store.showTags).toBe(false);
		expect(store.showUsers).toBe(false);

		store.viewMode = 'tags';
		expect(store.showTags).toBe(true);
		expect(store.showTrashed).toBe(false);

		store.viewMode = 'users';
		expect(store.showUsers).toBe(true);
		expect(store.showTags).toBe(false);
	});

	it('entryViewMode defaults to file and is settable', () => {
		const store = createLibraryExplorer(() => 'lib-1');
		expect(store.entryViewMode).toBe('file');
		store.entryViewMode = 'card';
		expect(store.entryViewMode).toBe('card');
	});
});

describe('createLibraryExplorer — permissions', () => {
	it('canManageUsers depends on library users and the default flag', async () => {
		apiMock.libraries.get.mockResolvedValue(makeLibrary({ isDefault: false }));
		apiMock.members.list.mockResolvedValue(makeUsers({ canManageUsers: true }));

		const store = createLibraryExplorer(() => 'lib-1');
		await store.refreshLibrary();
		await store.refreshLibraryUsers();

		expect(store.canManageUsers).toBe(true);
	});

	it('canManageUsers is false for a default library', async () => {
		apiMock.libraries.get.mockResolvedValue(makeLibrary({ isDefault: true }));
		apiMock.members.list.mockResolvedValue(makeUsers({ canManageUsers: true }));

		const store = createLibraryExplorer(() => 'lib-1');
		await store.refreshLibrary();
		await store.refreshLibraryUsers();

		expect(store.canManageUsers).toBe(false);
	});

	it('canManageLibrary is true for the library owner', async () => {
		apiMock.libraries.get.mockResolvedValue(makeLibrary({ ownerId: 'user-1' }));
		apiMock.members.list.mockResolvedValue(makeUsers({}));

		const store = createLibraryExplorer(
			() => 'lib-1',
			() => null,
			() => false,
			() => USER
		);
		await store.refreshLibrary();
		await store.refreshLibraryUsers();

		expect(store.canManageLibrary).toBe(true);
	});

	it('canManageLibrary is true for an admin member', async () => {
		apiMock.libraries.get.mockResolvedValue(makeLibrary({ ownerId: 'other-user' }));
		apiMock.members.list.mockResolvedValue(
			makeUsers({
				members: [
					{
						id: 'm1',
						userId: 'user-1',
						role: 'admin',
						isOwner: false,
						createdAt: '',
						user: { id: 'user-1', email: '', displayName: '', avatarUrl: null }
					}
				]
			})
		);

		const store = createLibraryExplorer(
			() => 'lib-1',
			() => null,
			() => false,
			() => USER
		);
		await store.refreshLibrary();
		await store.refreshLibraryUsers();

		expect(store.canManageLibrary).toBe(true);
	});

	it('canManageLibrary is false for viewers', async () => {
		apiMock.libraries.get.mockResolvedValue(makeLibrary({ ownerId: 'other-user' }));
		apiMock.members.list.mockResolvedValue(
			makeUsers({
				members: [
					{
						id: 'm1',
						userId: 'user-1',
						role: 'viewer',
						isOwner: false,
						createdAt: '',
						user: { id: 'user-1', email: '', displayName: '', avatarUrl: null }
					}
				]
			})
		);

		const store = createLibraryExplorer(
			() => 'lib-1',
			() => null,
			() => false,
			() => USER
		);
		await store.refreshLibrary();
		await store.refreshLibraryUsers();

		expect(store.canManageLibrary).toBe(false);
	});

	it('canManageLibrary is false when there is no user', () => {
		const store = createLibraryExplorer(() => 'lib-1');
		expect(store.canManageLibrary).toBe(false);
	});
});

describe('createLibraryExplorer — entries / selection', () => {
	it('files and folders split entries by kind', () => {
		const file = makeFile({ id: 'f1' });
		const folder = makeFolder({ id: 'fo1' });

		const store = createLibraryExplorer(() => 'lib-1');
		store.entries = [file, folder];

		expect(store.files).toHaveLength(1);
		expect(store.files[0]!.id).toBe('f1');
		expect(store.folders).toHaveLength(1);
		expect(store.folders[0]!.id).toBe('fo1');
	});

	it('clearSelection clears selections and only resets the anchor when asked', () => {
		const store = createLibraryExplorer(() => 'lib-1');

		store.selectedFiles.add('f1');
		store.selectedFolders.add('fo1');
		store.lastClickedIndex = 5;

		store.clearSelection();
		expect(store.selectedFiles.size).toBe(0);
		expect(store.selectedFolders.size).toBe(0);
		expect(store.lastClickedIndex).toBe(5); // anchor preserved without the flag

		store.selectedFiles.add('f2');
		store.clearSelection(true);
		expect(store.selectedFiles.size).toBe(0);
		expect(store.lastClickedIndex).toBeNull();
	});

	it('isEntrySelected checks files and folders', () => {
		const store = createLibraryExplorer(() => 'lib-1');

		store.selectedFiles.add('f1');
		store.selectedFolders.add('fo1');

		expect(store.isEntrySelected({ kind: 'file', id: 'f1' } as LibraryEntry)).toBe(true);
		expect(store.isEntrySelected({ kind: 'file', id: 'f2' } as LibraryEntry)).toBe(false);
		expect(store.isEntrySelected({ kind: 'folder', id: 'fo1' } as LibraryEntry)).toBe(true);
		expect(store.isEntrySelected({ kind: 'folder', id: 'fo2' } as LibraryEntry)).toBe(false);
	});
});

describe('createLibraryExplorer — buildFolderQuery', () => {
	it('adds the folder param to an existing query', () => {
		const store = createLibraryExplorer(() => 'lib-1');
		expect(store.buildFolderQuery('f1', { other: 'value' })).toEqual({
			other: 'value',
			folder: 'f1'
		});
	});

	it('removes the folder param when navigating to the root', () => {
		const store = createLibraryExplorer(() => 'lib-1');
		expect(store.buildFolderQuery(null, { folder: 'old', other: 'value' })).toEqual({
			other: 'value'
		});
	});

	it('defaults to an empty base query', () => {
		const store = createLibraryExplorer(() => 'lib-1');
		expect(store.buildFolderQuery('f1')).toEqual({ folder: 'f1' });
	});
});

describe('createLibraryExplorer — fetchPage', () => {
	it('includes trashed=true in the trash view', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		store.viewMode = 'trash';
		apiMock.files.list.mockResolvedValueOnce(emptyPage());

		await store.fetchPage();

		expect(apiMock.files.list).toHaveBeenCalledWith('lib-1', { trashed: 'true' });
	});

	it('includes the folder param when inside a folder', async () => {
		const store = createLibraryExplorer(
			() => 'lib-1',
			() => 'f1'
		);
		apiMock.files.list.mockResolvedValueOnce(emptyPage());

		await store.fetchPage();

		expect(apiMock.files.list).toHaveBeenCalledWith('lib-1', { folder: 'f1' });
	});

	it('includes the cursor param', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		apiMock.files.list.mockResolvedValueOnce(emptyPage());

		await store.fetchPage('cursor-abc');

		expect(apiMock.files.list).toHaveBeenCalledWith('lib-1', { cursor: 'cursor-abc' });
	});

	it('trash view ignores the folder param', async () => {
		const store = createLibraryExplorer(
			() => 'lib-1',
			() => 'f1'
		);
		store.viewMode = 'trash';
		apiMock.files.list.mockResolvedValueOnce(emptyPage());

		await store.fetchPage('c1');

		expect(apiMock.files.list).toHaveBeenCalledWith('lib-1', {
			trashed: 'true',
			cursor: 'c1'
		});
	});
});

describe('createLibraryExplorer — loadMore', () => {
	it('appends entries and updates cursor/total/breadcrumbs', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		const newEntry = makeFile({ id: 'f2', name: 'new.txt' });

		apiMock.files.list.mockResolvedValueOnce(
			emptyPage({
				entries: [newEntry],
				nextCursor: 'cursor-2',
				totalCount: 5,
				breadcrumbs: [{ id: 'b1', name: 'Root' }]
			})
		);
		store.nextCursor = 'cursor-1';

		await store.loadMore();

		expect(store.entries).toHaveLength(1);
		expect(store.nextCursor).toBe('cursor-2');
		expect(store.totalCount).toBe(5);
		expect(store.breadcrumbs).toEqual([{ id: 'b1', name: 'Root' }]);
	});

	it('does nothing when there is no cursor', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		store.nextCursor = null;
		apiMock.files.list.mockClear();

		await store.loadMore();
		expect(apiMock.files.list).not.toHaveBeenCalled();
	});

	it('does nothing while already loading', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		store.nextCursor = 'cursor-1';
		store.loadingMore = true;
		apiMock.files.list.mockClear();

		await store.loadMore();
		expect(apiMock.files.list).not.toHaveBeenCalled();
	});

	it('caches the appended state for the current view', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		apiMock.files.list.mockResolvedValueOnce(
			emptyPage({ entries: [makeFile({ id: 'f2' })], nextCursor: null, totalCount: 1 })
		);
		store.nextCursor = 'cursor-1';

		await store.loadMore();

		// Restore via resetAndFetch with preserveEntries — the cache should be primed.
		expect(store.loadingMore).toBe(false);
		expect(store.entries).toHaveLength(1);
	});
});

describe('createLibraryExplorer — resetAndFetch', () => {
	it('clears entries and selection, then reloads', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		store.entries = [makeFile({ id: 'old' })];
		store.selectedFiles.add('old');

		apiMock.files.list.mockResolvedValueOnce(emptyPage());

		await store.resetAndFetch();

		expect(store.entries).toEqual([]);
		expect(store.selectedFiles.size).toBe(0);
		expect(store.filesPending).toBe(false);
	});

	it('updates trashedCount in the trash view', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		store.viewMode = 'trash';

		apiMock.files.list.mockResolvedValueOnce(emptyPage({ totalCount: 3 }));

		await store.resetAndFetch();

		expect(store.trashedCount).toBe(3);
	});

	it('sends trashed=true after switching viewMode to trash', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		store.viewMode = 'trash';
		apiMock.files.list.mockClear();
		apiMock.files.list.mockResolvedValue(emptyPage());

		await store.resetAndFetch();

		expect(apiMock.files.list).toHaveBeenCalledWith('lib-1', { trashed: 'true' });
	});

	it('restores cached entries when preserveEntries is set', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		const cached = makeFile({ id: 'cached' });
		const fresh = makeFile({ id: 'fresh' });

		// First load primes the cache for the root view.
		apiMock.files.list.mockResolvedValueOnce(emptyPage({ entries: [cached], totalCount: 1 }));
		await store.resetAndFetch();
		expect(store.entries.map((e) => e.id)).toEqual(['cached']);

		// preserveEntries restores cache synchronously before the network resolves.
		apiMock.files.list.mockResolvedValueOnce(emptyPage({ entries: [fresh], totalCount: 1 }));
		await store.resetAndFetch({ preserveEntries: true });
		expect(store.entries.map((e) => e.id)).toEqual(['fresh']);
	});

	it('keeps existing entries and skips pending state when silent', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		store.entries = [makeFile({ id: 'keep' })];
		store.filesPending = false;

		apiMock.files.list.mockResolvedValueOnce(emptyPage({ entries: [makeFile({ id: 'new' })] }));

		await store.resetAndFetch({ silent: true });

		expect(store.entries.map((e) => e.id)).toEqual(['new']);
		expect(store.filesPending).toBe(false);
	});

	it('swallows fetch errors and logs them', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const store = createLibraryExplorer(() => 'lib-1');
		apiMock.files.list.mockRejectedValueOnce(new Error('boom'));

		await store.resetAndFetch();

		expect(spy).toHaveBeenCalled();
		expect(store.filesPending).toBe(false);
		spy.mockRestore();
	});
});

describe('createLibraryExplorer — refreshers', () => {
	it('refreshLibrary loads the library', async () => {
		const lib = makeLibrary({ name: 'Loaded' });
		apiMock.libraries.get.mockResolvedValue(lib);
		const store = createLibraryExplorer(() => 'lib-1');
		await store.refreshLibrary();
		expect(apiMock.libraries.get).toHaveBeenCalledWith('lib-1');
		expect(store.library).toEqual(lib);
	});

	it('refreshLibraryUsers loads the member list', async () => {
		const users = makeUsers({ canManageUsers: true });
		apiMock.members.list.mockResolvedValue(users);
		const store = createLibraryExplorer(() => 'lib-1');
		await store.refreshLibraryUsers();
		expect(apiMock.members.list).toHaveBeenCalledWith('lib-1');
		expect(store.libraryUsers).toEqual(users);
	});

	it('refreshTags fetches the tag list', async () => {
		const tags: LibraryTag[] = [
			{ id: 't1', name: 'Tag', libraryId: 'lib-1', color: '#E11D48', createdAt: '', updatedAt: '' }
		];
		apiMock.tags.list.mockResolvedValueOnce(tags);
		const store = createLibraryExplorer(() => 'lib-1');
		await store.refreshTags();
		expect(apiMock.tags.list).toHaveBeenCalledWith('lib-1');
		expect(store.libraryTags).toEqual(tags);
	});

	it('refreshTrashedCount fetches the trashed total', async () => {
		apiMock.files.list.mockResolvedValueOnce(emptyPage({ totalCount: 7 }));
		const store = createLibraryExplorer(() => 'lib-1');
		await store.refreshTrashedCount();
		expect(apiMock.files.list).toHaveBeenCalledWith('lib-1', { trashed: 'true', limit: '1' });
		expect(store.trashedCount).toBe(7);
	});

	it('refreshFolders returns the folder list', async () => {
		const folders = [makeFolder({ id: 'fo1', name: 'Docs' })];
		apiMock.folders.list.mockResolvedValueOnce(folders);
		const store = createLibraryExplorer(() => 'lib-1');
		await expect(store.refreshFolders()).resolves.toEqual(folders);
		expect(apiMock.folders.list).toHaveBeenCalledWith('lib-1');
	});

	it('reads the libraryId getter lazily', async () => {
		let id = 'lib-a';
		apiMock.tags.list.mockResolvedValue([]);
		const store = createLibraryExplorer(() => id);
		await store.refreshTags();
		expect(apiMock.tags.list).toHaveBeenLastCalledWith('lib-a');
		id = 'lib-b';
		await store.refreshTags();
		expect(apiMock.tags.list).toHaveBeenLastCalledWith('lib-b');
	});
});

describe('createLibraryExplorer — fetchInitialData', () => {
	it('loads files, trashed count and tags in parallel', async () => {
		const file = makeFile({ id: 'f1' });
		const tags: LibraryTag[] = [
			{ id: 't1', name: 'Tag', libraryId: 'lib-1', color: '#000', createdAt: '', updatedAt: '' }
		];
		apiMock.files.list.mockImplementation((_id: string, query?: { trashed?: string }) => {
			if (query?.trashed) return Promise.resolve(emptyPage({ totalCount: 4 }));
			return Promise.resolve(emptyPage({ entries: [file], totalCount: 1 }));
		});
		apiMock.tags.list.mockResolvedValue(tags);

		const store = createLibraryExplorer(() => 'lib-1');
		await store.fetchInitialData();

		expect(store.entries.map((e) => e.id)).toEqual(['f1']);
		expect(store.trashedCount).toBe(4);
		expect(store.libraryTags).toEqual(tags);
		expect(store.filesPending).toBe(false);
	});

	it('sends trashed=true for the main listing in the trash view', async () => {
		const store = createLibraryExplorer(
			() => 'lib-1',
			() => null,
			() => true
		);
		apiMock.files.list.mockResolvedValue(emptyPage());

		await store.fetchInitialData();

		const mainCall = apiMock.files.list.mock.calls.find(
			(c) => (c[1] as { limit?: string } | undefined)?.limit !== '1'
		);
		expect((mainCall![1] as { trashed?: string }).trashed).toBe('true');
	});

	it('does NOT send trashed for the main listing in the files view', async () => {
		const store = createLibraryExplorer(() => 'lib-1');
		apiMock.files.list.mockResolvedValue(emptyPage());

		await store.fetchInitialData();

		const mainCall = apiMock.files.list.mock.calls.find(
			(c) => (c[1] as { limit?: string } | undefined)?.limit !== '1'
		);
		expect((mainCall![1] as { trashed?: string }).trashed).toBeUndefined();
	});

	it('sends the folder param for the main listing when inside a folder', async () => {
		const store = createLibraryExplorer(
			() => 'lib-1',
			() => 'folder-7'
		);
		apiMock.files.list.mockResolvedValue(emptyPage());

		await store.fetchInitialData();

		const mainCall = apiMock.files.list.mock.calls.find(
			(c) => (c[1] as { limit?: string } | undefined)?.limit !== '1'
		);
		expect((mainCall![1] as { folder?: string }).folder).toBe('folder-7');
	});

	it('resets to empty state on error', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const store = createLibraryExplorer(() => 'lib-1');
		store.entries = [makeFile({ id: 'stale' })];
		store.trashedCount = 9;

		apiMock.files.list.mockRejectedValue(new Error('down'));
		apiMock.tags.list.mockRejectedValue(new Error('down'));

		await store.fetchInitialData();

		expect(store.entries).toEqual([]);
		expect(store.breadcrumbs).toEqual([]);
		expect(store.nextCursor).toBeNull();
		expect(store.totalCount).toBe(0);
		expect(store.trashedCount).toBe(0);
		expect(store.libraryTags).toEqual([]);
		expect(store.filesPending).toBe(false);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
