import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryFolder } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	folders: {
		create: vi.fn(),
		move: vi.fn(),
		delete: vi.fn()
	}
}));

const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { createLibraryFolderActions } from './library-folder-actions.svelte';
import { ROOT_MOVE_VALUE } from '$lib/utils/folder-tree';

function makeFolder(
	overrides: Partial<LibraryFolder> & { id: string; name: string }
): LibraryFolder {
	return {
		libraryId: 'lib-1',
		parentFolderId: null,
		kind: 'folder',
		trashedAt: null,
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		owner: null,
		tags: [],
		...overrides
	};
}

describe('createLibraryFolderActions', () => {
	let resetAndFetch: ReturnType<typeof vi.fn>;
	let refreshFolders: ReturnType<typeof vi.fn>;
	let refreshTrashedCount: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();

		resetAndFetch = vi.fn().mockResolvedValue(undefined);
		refreshFolders = vi.fn().mockResolvedValue([]);
		refreshTrashedCount = vi.fn().mockResolvedValue(undefined);
	});

	function createActions(folderId: string | null = null, libraryId = 'lib-1') {
		return createLibraryFolderActions(
			() => libraryId,
			() => folderId,
			refreshFolders as unknown as Parameters<typeof createLibraryFolderActions>[2],
			resetAndFetch as unknown as Parameters<typeof createLibraryFolderActions>[3],
			refreshTrashedCount as unknown as Parameters<typeof createLibraryFolderActions>[4]
		);
	}

	it('starts with default modal state', () => {
		const actions = createActions();
		expect(actions.createFolderOpen).toBe(false);
		expect(actions.createFolderName).toBe('');
		expect(actions.creatingFolder).toBe(false);
		expect(actions.moveFolderOpen).toBe(false);
		expect(actions.movingFolder).toBeNull();
		expect(actions.moveDestinationValue).toBe(ROOT_MOVE_VALUE);
		expect(actions.moveLoading).toBe(false);
		expect(actions.moveFolderSaving).toBe(false);
		expect(actions.allFolders).toEqual([]);
		expect(actions.moveDestinationOptions).toEqual([{ label: 'Root', value: ROOT_MOVE_VALUE }]);
	});

	it('openCreateFolderModal resets state and opens modal', () => {
		const actions = createActions();
		actions.createFolderName = 'leftover';
		actions.createFolderOpen = false;

		actions.openCreateFolderModal();

		expect(actions.createFolderName).toBe('');
		expect(actions.createFolderOpen).toBe(true);
	});

	it('createFolder calls api and resets state on success', async () => {
		apiMock.folders.create.mockResolvedValueOnce(makeFolder({ id: 'f-new', name: 'New Folder' }));

		const actions = createActions('parent-1');
		actions.createFolderOpen = true;
		actions.createFolderName = 'New Folder';

		await actions.createFolder();

		expect(apiMock.folders.create).toHaveBeenCalledWith('lib-1', {
			name: 'New Folder',
			parentFolderId: 'parent-1'
		});
		expect(actions.createFolderOpen).toBe(false);
		expect(actions.createFolderName).toBe('');
		expect(resetAndFetch).toHaveBeenCalledTimes(1);
		expect(actions.creatingFolder).toBe(false);
	});

	it('createFolder passes null parent when at root', async () => {
		apiMock.folders.create.mockResolvedValueOnce(makeFolder({ id: 'f-new', name: 'Root Folder' }));

		const actions = createActions(null);
		actions.createFolderName = 'Root Folder';

		await actions.createFolder();

		expect(apiMock.folders.create).toHaveBeenCalledWith('lib-1', {
			name: 'Root Folder',
			parentFolderId: null
		});
	});

	it('createFolder trims whitespace before sending', async () => {
		apiMock.folders.create.mockResolvedValueOnce(makeFolder({ id: 'f-new', name: 'Trimmed' }));

		const actions = createActions();
		actions.createFolderName = '  Trimmed  ';

		await actions.createFolder();

		expect(apiMock.folders.create).toHaveBeenCalledWith('lib-1', {
			name: 'Trimmed',
			parentFolderId: null
		});
	});

	it('createFolder does nothing when name is empty', async () => {
		const actions = createActions();
		actions.createFolderName = '   ';

		await actions.createFolder();

		expect(apiMock.folders.create).not.toHaveBeenCalled();
	});

	it('createFolder shows toast on error and clears creatingFolder', async () => {
		apiMock.folders.create.mockRejectedValueOnce(new Error('fail'));

		const actions = createActions();
		actions.createFolderName = 'Test';

		await actions.createFolder();

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to create folder',
			color: 'error'
		});
		expect(actions.creatingFolder).toBe(false);
	});

	it('moveDestinationOptions excludes self and descendants', async () => {
		const root = makeFolder({ id: 'root-f', name: 'Root' });
		const child = makeFolder({ id: 'child-f', name: 'Child', parentFolderId: 'root-f' });
		const grandchild = makeFolder({ id: 'gc-f', name: 'Grandchild', parentFolderId: 'child-f' });
		const unrelated = makeFolder({ id: 'other-f', name: 'Other' });

		refreshFolders.mockResolvedValueOnce([root, child, grandchild, unrelated]);

		const actions = createActions();
		await actions.openMoveFolderModal(root);

		const optionValues = actions.moveDestinationOptions.map((o) => o.value);

		expect(optionValues).toContain(ROOT_MOVE_VALUE);
		expect(optionValues).toContain('other-f');
		expect(optionValues).not.toContain('root-f');
		expect(optionValues).not.toContain('child-f');
		expect(optionValues).not.toContain('gc-f');
	});

	it('moveDestinationOptions builds nested labels', async () => {
		const parent = makeFolder({ id: 'p', name: 'Parent' });
		const child = makeFolder({ id: 'c', name: 'Child', parentFolderId: 'p' });
		const target = makeFolder({ id: 't', name: 'Target' });

		refreshFolders.mockResolvedValueOnce([parent, child, target]);

		const actions = createActions();
		await actions.openMoveFolderModal(target);

		const childOption = actions.moveDestinationOptions.find((o) => o.value === 'c');
		expect(childOption?.label).toBe('Parent / Child');
	});

	it('moveDestinationOptions sorts options alphabetically by label', async () => {
		const zeta = makeFolder({ id: 'z', name: 'Zeta' });
		const alpha = makeFolder({ id: 'a', name: 'Alpha' });
		const target = makeFolder({ id: 't', name: 'Target' });

		refreshFolders.mockResolvedValueOnce([zeta, alpha, target]);

		const actions = createActions();
		await actions.openMoveFolderModal(target);

		const labels = actions.moveDestinationOptions.map((o) => o.label);
		// Root stays first; remaining are sorted.
		expect(labels).toEqual(['Root', 'Alpha', 'Zeta']);
	});

	it('moveDestinationOptions stops climbing on a missing parent', async () => {
		const orphan = makeFolder({ id: 'orphan', name: 'Orphan', parentFolderId: 'ghost' });
		const target = makeFolder({ id: 't', name: 'Target' });

		refreshFolders.mockResolvedValueOnce([orphan, target]);

		const actions = createActions();
		await actions.openMoveFolderModal(target);

		const orphanOption = actions.moveDestinationOptions.find((o) => o.value === 'orphan');
		expect(orphanOption?.label).toBe('Orphan');
	});

	it('moveDestinationOptions returns only Root when no movingFolder', () => {
		const actions = createActions();
		expect(actions.moveDestinationOptions).toEqual([{ label: 'Root', value: ROOT_MOVE_VALUE }]);
	});

	it('openMoveFolderModal sets state and loads folders', async () => {
		const folders = [makeFolder({ id: 'f1', name: 'One' })];
		refreshFolders.mockResolvedValueOnce(folders);

		const actions = createActions();
		const folder = makeFolder({ id: 'f-move', name: 'Moving', parentFolderId: 'f1' });

		await actions.openMoveFolderModal(folder);

		expect(actions.movingFolder).toStrictEqual(folder);
		expect(actions.moveDestinationValue).toBe('f1');
		expect(actions.moveFolderOpen).toBe(true);
		expect(actions.moveLoading).toBe(false);
		expect(actions.allFolders).toEqual(folders);
	});

	it('openMoveFolderModal defaults destination to Root for a top-level folder', async () => {
		refreshFolders.mockResolvedValueOnce([]);

		const actions = createActions();
		await actions.openMoveFolderModal(makeFolder({ id: 'f-move', name: 'Moving' }));

		expect(actions.moveDestinationValue).toBe(ROOT_MOVE_VALUE);
	});

	it('openMoveFolderModal shows toast on error and clears loading', async () => {
		refreshFolders.mockRejectedValueOnce(new Error('fail'));

		const actions = createActions();
		await actions.openMoveFolderModal(makeFolder({ id: 'f1', name: 'Test' }));

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to load folders',
			color: 'error'
		});
		expect(actions.moveLoading).toBe(false);
	});

	it('moveFolder calls api with null parent for root', async () => {
		apiMock.folders.move.mockResolvedValueOnce(undefined);

		const actions = createActions();
		actions.movingFolder = makeFolder({ id: 'f-move', name: 'Moving' });
		actions.moveDestinationValue = ROOT_MOVE_VALUE;

		await actions.moveFolder();

		expect(apiMock.folders.move).toHaveBeenCalledWith('lib-1', 'f-move', {
			parentFolderId: null
		});
		expect(actions.moveFolderOpen).toBe(false);
		expect(resetAndFetch).toHaveBeenCalledTimes(1);
		expect(actions.moveFolderSaving).toBe(false);
	});

	it('moveFolder calls api with folder id as parent', async () => {
		apiMock.folders.move.mockResolvedValueOnce(undefined);

		const actions = createActions();
		actions.movingFolder = makeFolder({ id: 'f-move', name: 'Moving' });
		actions.moveDestinationValue = 'dest-folder';

		await actions.moveFolder();

		expect(apiMock.folders.move).toHaveBeenCalledWith('lib-1', 'f-move', {
			parentFolderId: 'dest-folder'
		});
	});

	it('moveFolder does nothing without a movingFolder', async () => {
		const actions = createActions();
		await actions.moveFolder();
		expect(apiMock.folders.move).not.toHaveBeenCalled();
	});

	it('moveFolder shows toast on error and clears saving', async () => {
		apiMock.folders.move.mockRejectedValueOnce(new Error('fail'));

		const actions = createActions();
		actions.movingFolder = makeFolder({ id: 'f1', name: 'Test' });

		await actions.moveFolder();

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to move folder',
			color: 'error'
		});
		expect(actions.moveFolderSaving).toBe(false);
	});

	it('deleteFolders calls api for each folder then refreshes', async () => {
		apiMock.folders.delete.mockResolvedValue(undefined);

		const actions = createActions();
		await actions.deleteFolders(['f1', 'f2']);

		expect(apiMock.folders.delete).toHaveBeenCalledWith('lib-1', 'f1');
		expect(apiMock.folders.delete).toHaveBeenCalledWith('lib-1', 'f2');
		expect(resetAndFetch).toHaveBeenCalledTimes(1);
		expect(refreshTrashedCount).toHaveBeenCalledTimes(1);
	});

	it('deleteFolder delegates to deleteFolders', async () => {
		apiMock.folders.delete.mockResolvedValue(undefined);

		const actions = createActions();
		await actions.deleteFolder(makeFolder({ id: 'f-del', name: 'Delete Me' }));

		expect(apiMock.folders.delete).toHaveBeenCalledWith('lib-1', 'f-del');
	});

	it('deleteFolders shows toast on error and skips refresh', async () => {
		apiMock.folders.delete.mockRejectedValueOnce(new Error('fail'));

		const actions = createActions();
		await actions.deleteFolders(['f1']);

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to delete folder',
			color: 'error'
		});
		expect(resetAndFetch).not.toHaveBeenCalled();
		expect(refreshTrashedCount).not.toHaveBeenCalled();
	});

	it('reads the libraryId getter lazily on each call', async () => {
		let libraryId = 'lib-a';
		apiMock.folders.create.mockResolvedValue(makeFolder({ id: 'x', name: 'X' }));

		const actions = createLibraryFolderActions(
			() => libraryId,
			() => null,
			refreshFolders as unknown as Parameters<typeof createLibraryFolderActions>[2],
			resetAndFetch as unknown as Parameters<typeof createLibraryFolderActions>[3],
			refreshTrashedCount as unknown as Parameters<typeof createLibraryFolderActions>[4]
		);

		actions.createFolderName = 'First';
		await actions.createFolder();
		expect(apiMock.folders.create).toHaveBeenLastCalledWith('lib-a', expect.anything());

		libraryId = 'lib-b';
		actions.createFolderName = 'Second';
		await actions.createFolder();
		expect(apiMock.folders.create).toHaveBeenLastCalledWith('lib-b', expect.anything());
	});
});
