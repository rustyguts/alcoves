import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.hoisted(() => ({
	tags: {
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		syncFileTags: vi.fn(),
		syncFolderTags: vi.fn()
	}
}));
vi.mock('$lib/api', () => ({ api: apiMock }));

const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn()
}));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { createLibraryTags } from './library-tags.svelte';
import { TAG_COLOR_PALETTE } from '$lib/shared/tag-colors';
import type { LibraryFile, LibraryFolder, LibraryTag } from '$lib/types/api';

function makeTag(overrides: Partial<LibraryTag> & { id: string; name: string }): LibraryTag {
	return {
		libraryId: 'lib-1',
		color: '#E11D48',
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		...overrides
	};
}

function makeFile(overrides: Partial<LibraryFile> & { id: string; name: string }): LibraryFile {
	return {
		libraryId: 'lib-1',
		parentFolderId: null,
		mimeType: 'text/plain',
		size: 100,
		kind: 'file',
		duration: null,
		width: null,
		height: null,
		originalCreatedAt: null,
		trashedAt: null,
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		owner: null,
		tags: [],
		...overrides
	} as LibraryFile;
}

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
	} as LibraryFolder;
}

/**
 * Build the store over caller-owned arrays, mirroring the Nuxt refs. `tags` is
 * reassignable through the setter (replacing `libraryTags.value = …`); `files`
 * is read through a getter and mutated in place on the objects.
 */
function setup(initialTags: LibraryTag[] = [], initialFiles: LibraryFile[] = []) {
	let tags = initialTags;
	const files = initialFiles;
	const store = createLibraryTags(
		() => 'lib-1',
		() => tags,
		(next) => {
			tags = next;
		},
		() => files
	);
	return {
		store,
		getTags: () => tags,
		getFiles: () => files
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createLibraryTags', () => {
	it('isTagAssigned returns true when file has the tag', () => {
		const tag = makeTag({ id: 't1', name: 'Important' });
		const file = makeFile({ id: 'f1', name: 'doc.txt', tags: [tag] });
		const { store } = setup([tag], [file]);

		expect(store.isTagAssigned(file, 't1')).toBe(true);
		expect(store.isTagAssigned(file, 't2')).toBe(false);
	});

	it('isFolderTagAssigned returns true when folder has the tag', () => {
		const tag = makeTag({ id: 't1', name: 'Important' });
		const folder = makeFolder({ id: 'fo1', name: 'Docs', tags: [tag] });
		const { store } = setup([tag]);

		expect(store.isFolderTagAssigned(folder, 't1')).toBe(true);
		expect(store.isFolderTagAssigned(folder, 't2')).toBe(false);
	});

	it('areAllFilesTagged checks all files', () => {
		const tag = makeTag({ id: 't1', name: 'Done' });
		const f1 = makeFile({ id: 'f1', name: 'a.txt', tags: [tag] });
		const f2 = makeFile({ id: 'f2', name: 'b.txt', tags: [] });
		const { store } = setup([tag], [f1, f2]);

		expect(store.areAllFilesTagged(['f1'], 't1')).toBe(true);
		expect(store.areAllFilesTagged(['f1', 'f2'], 't1')).toBe(false);
		expect(store.areAllFilesTagged(['nonexistent'], 't1')).toBe(false);
	});

	it('getTagColorChoices returns palette for palette colors', () => {
		const tag = makeTag({ id: 't1', name: 'Red', color: '#E11D48' });
		const { store } = setup([tag]);

		const choices = store.getTagColorChoices(tag);
		expect(choices).toEqual([...TAG_COLOR_PALETTE]);
	});

	it('getTagColorChoices prepends custom color', () => {
		const tag = makeTag({ id: 't1', name: 'Custom', color: '#ABCDEF' });
		const { store } = setup([tag]);

		const choices = store.getTagColorChoices(tag);
		expect(choices[0]).toBe('#ABCDEF');
		expect(choices.length).toBe(TAG_COLOR_PALETTE.length + 1);
	});

	it('isTagColorUsedByAnotherTag detects color conflicts', () => {
		const t1 = makeTag({ id: 't1', name: 'A', color: '#E11D48' });
		const t2 = makeTag({ id: 't2', name: 'B', color: '#3B82F6' });
		const { store } = setup([t1, t2]);

		expect(store.isTagColorUsedByAnotherTag('t1', '#3B82F6')).toBe(true);
		expect(store.isTagColorUsedByAnotherTag('t1', '#E11D48')).toBe(false);
		expect(store.isTagColorUsedByAnotherTag('t1', '#FFFFFF')).toBe(false);
	});

	it('selectTagColor allows selecting a color used by another tag', () => {
		apiMock.tags.update.mockResolvedValueOnce(makeTag({ id: 't1', name: 'A', color: '#3B82F6' }));
		const t1 = makeTag({ id: 't1', name: 'A', color: '#E11D48' });
		const t2 = makeTag({ id: 't2', name: 'B', color: '#3B82F6' });
		const { store } = setup([t1, t2]);

		store.selectTagColor(t1, '#3B82F6');
		expect(apiMock.tags.update).toHaveBeenCalled();
	});

	it('selectTagColor calls updateTagColor when color is available', () => {
		apiMock.tags.update.mockResolvedValueOnce(makeTag({ id: 't1', name: 'A', color: '#22C55E' }));
		const t1 = makeTag({ id: 't1', name: 'A', color: '#E11D48' });
		const { store } = setup([t1]);

		store.selectTagColor(t1, '#22C55E');
		expect(apiMock.tags.update).toHaveBeenCalled();
	});

	it('createTag calls api and adds to libraryTags', async () => {
		const newTag = makeTag({ id: 't-new', name: 'New Tag' });
		apiMock.tags.create.mockResolvedValueOnce(newTag);

		const { store, getTags } = setup([]);
		store.createTagName = 'New Tag';

		await store.createTag();

		expect(apiMock.tags.create).toHaveBeenCalledWith('lib-1', { name: 'New Tag' });
		expect(getTags()).toContainEqual(newTag);
		expect(store.createTagName).toBe('');
	});

	it('createTag sends selected color when provided', async () => {
		const newTag = makeTag({ id: 't-new', name: 'New Tag', color: '#22C55E' });
		apiMock.tags.create.mockResolvedValueOnce(newTag);

		const { store, getTags } = setup([]);
		store.createTagName = 'New Tag';

		await store.createTag('#22c55e');

		expect(apiMock.tags.create).toHaveBeenCalledWith('lib-1', {
			name: 'New Tag',
			color: '#22C55E'
		});
		expect(getTags()).toContainEqual(newTag);
	});

	it('createTag keeps the list sorted by name', async () => {
		const existing = makeTag({ id: 't1', name: 'Zebra' });
		const newTag = makeTag({ id: 't-new', name: 'Apple' });
		apiMock.tags.create.mockResolvedValueOnce(newTag);

		const { store, getTags } = setup([existing]);
		store.createTagName = 'Apple';

		await store.createTag();

		expect(getTags().map((t) => t.name)).toEqual(['Apple', 'Zebra']);
	});

	it('createTag does nothing with empty name', async () => {
		const { store } = setup();
		store.createTagName = '   ';

		await store.createTag();
		expect(apiMock.tags.create).not.toHaveBeenCalled();
	});

	it('createTag toggles creatingTag around the request', async () => {
		const newTag = makeTag({ id: 't-new', name: 'New Tag' });
		let duringCall = false;
		apiMock.tags.create.mockImplementationOnce(async () => {
			duringCall = store.creatingTag;
			return newTag;
		});

		const { store } = setup([]);
		store.createTagName = 'New Tag';

		expect(store.creatingTag).toBe(false);
		await store.createTag();
		expect(duringCall).toBe(true);
		expect(store.creatingTag).toBe(false);
	});

	it('createTag shows toast on error and resets creatingTag', async () => {
		apiMock.tags.create.mockRejectedValueOnce(new Error('fail'));

		const { store } = setup();
		store.createTagName = 'Test';

		await store.createTag();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to create tag', color: 'error' });
		expect(store.creatingTag).toBe(false);
	});

	it('renameTag calls api and replaces tag', async () => {
		const tag = makeTag({ id: 't1', name: 'Old' });
		const updated = makeTag({ id: 't1', name: 'New' });
		apiMock.tags.update.mockResolvedValueOnce(updated);

		const { store, getTags } = setup([tag]);

		await store.renameTag(tag, 'New');

		expect(apiMock.tags.update).toHaveBeenCalledWith('lib-1', 't1', { name: 'New' });
		expect(getTags()[0]!.name).toBe('New');
	});

	it('renameTag does nothing when name is same', async () => {
		const tag = makeTag({ id: 't1', name: 'Same' });
		const { store } = setup([tag]);

		await store.renameTag(tag, 'Same');
		expect(apiMock.tags.update).not.toHaveBeenCalled();
	});

	it('renameTag does nothing with empty name', async () => {
		const tag = makeTag({ id: 't1', name: 'Test' });
		const { store } = setup([tag]);

		await store.renameTag(tag, '  ');
		expect(apiMock.tags.update).not.toHaveBeenCalled();
	});

	it('renameTag shows toast on error', async () => {
		const tag = makeTag({ id: 't1', name: 'Old' });
		apiMock.tags.update.mockRejectedValueOnce(new Error('fail'));

		const { store } = setup([tag]);
		await store.renameTag(tag, 'New');

		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to rename tag', color: 'error' });
	});

	it('deleteTag removes tag from libraryTags and files', async () => {
		apiMock.tags.delete.mockResolvedValueOnce(undefined);

		const tag = makeTag({ id: 't1', name: 'Delete Me' });
		const file = makeFile({ id: 'f1', name: 'doc.txt', tags: [tag] });
		const { store, getTags, getFiles } = setup([tag], [file]);

		await store.deleteTag('t1');

		expect(apiMock.tags.delete).toHaveBeenCalledWith('lib-1', 't1');
		expect(getTags()).toHaveLength(0);
		expect(getFiles()[0]!.tags).toHaveLength(0);
	});

	it('deleteTag shows toast on error', async () => {
		apiMock.tags.delete.mockRejectedValueOnce(new Error('fail'));

		const tag = makeTag({ id: 't1', name: 'Delete Me' });
		const { store, getTags } = setup([tag]);

		await store.deleteTag('t1');
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to delete tag', color: 'error' });
		expect(getTags()).toHaveLength(1);
	});

	it('replaceTag updates libraryTags and file tags', () => {
		const tag = makeTag({ id: 't1', name: 'Old', color: '#E11D48' });
		const file = makeFile({ id: 'f1', name: 'doc.txt', tags: [tag] });
		const { store, getTags, getFiles } = setup([tag], [file]);

		const updated = makeTag({ id: 't1', name: 'New', color: '#3B82F6' });
		store.replaceTag(updated);

		expect(getTags()[0]!.name).toBe('New');
		expect(getTags()[0]!.color).toBe('#3B82F6');
		expect(getFiles()[0]!.tags[0]!.name).toBe('New');
	});

	it('toggleTagForFiles adds tag when not all files have it', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const f1 = makeFile({ id: 'f1', name: 'a.txt', tags: [tag] });
		const f2 = makeFile({ id: 'f2', name: 'b.txt', tags: [] });
		apiMock.tags.syncFileTags.mockResolvedValue([tag]);

		const { store } = setup([tag], [f1, f2]);
		await store.toggleTagForFiles(['f1', 'f2'], 't1');

		expect(apiMock.tags.syncFileTags).toHaveBeenCalledTimes(2);
		// Both files should be asked to include the tag.
		for (const call of apiMock.tags.syncFileTags.mock.calls) {
			expect(call[2]).toEqual({ tagIds: ['t1'] });
		}
	});

	it('toggleTagForFiles removes tag when all files have it', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const f1 = makeFile({ id: 'f1', name: 'a.txt', tags: [tag] });
		const f2 = makeFile({ id: 'f2', name: 'b.txt', tags: [tag] });
		apiMock.tags.syncFileTags.mockResolvedValue([]);

		const { store } = setup([tag], [f1, f2]);
		await store.toggleTagForFiles(['f1', 'f2'], 't1');

		expect(apiMock.tags.syncFileTags).toHaveBeenCalledTimes(2);
		for (const call of apiMock.tags.syncFileTags.mock.calls) {
			expect(call[2]).toEqual({ tagIds: [] });
		}
	});

	it('toggleTagForFiles does nothing for empty file list', async () => {
		const { store } = setup();
		await store.toggleTagForFiles([], 't1');
		expect(apiMock.tags.syncFileTags).not.toHaveBeenCalled();
	});

	it('toggleTagForFiles shows toast on error', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const f1 = makeFile({ id: 'f1', name: 'a.txt', tags: [] });
		apiMock.tags.syncFileTags.mockRejectedValue(new Error('fail'));

		const { store } = setup([tag], [f1]);
		await store.toggleTagForFiles(['f1'], 't1');

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to update file tags',
			color: 'error'
		});
	});

	it('saveFileTags assigns the returned tags to the file', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const file = makeFile({ id: 'f1', name: 'a.txt', tags: [] });
		apiMock.tags.syncFileTags.mockResolvedValueOnce([tag]);

		const { store } = setup([tag], [file]);
		await store.saveFileTags(file, ['t1']);

		expect(apiMock.tags.syncFileTags).toHaveBeenCalledWith('lib-1', 'f1', { tagIds: ['t1'] });
		expect(file.tags).toEqual([tag]);
	});

	it('toggleTagForFolder adds tag when not assigned', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const folder = makeFolder({ id: 'fo1', name: 'Docs', tags: [] });
		apiMock.tags.syncFolderTags.mockResolvedValueOnce([tag]);

		const { store } = setup([tag]);
		await store.toggleTagForFolder(folder, 't1');

		expect(apiMock.tags.syncFolderTags).toHaveBeenCalledWith('lib-1', 'fo1', { tagIds: ['t1'] });
		expect(folder.tags).toEqual([tag]);
	});

	it('toggleTagForFolder removes tag when assigned', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const folder = makeFolder({ id: 'fo1', name: 'Docs', tags: [tag] });
		apiMock.tags.syncFolderTags.mockResolvedValueOnce([]);

		const { store } = setup([tag]);
		await store.toggleTagForFolder(folder, 't1');

		expect(apiMock.tags.syncFolderTags).toHaveBeenCalledWith('lib-1', 'fo1', { tagIds: [] });
		expect(folder.tags).toEqual([]);
	});

	it('toggleTagForFolder shows toast on error', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const folder = makeFolder({ id: 'fo1', name: 'Docs', tags: [] });
		apiMock.tags.syncFolderTags.mockRejectedValueOnce(new Error('fail'));

		const { store } = setup([tag]);
		await store.toggleTagForFolder(folder, 't1');

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to update folder tags',
			color: 'error'
		});
	});

	it('saveFolderTags assigns the returned tags to the folder', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag' });
		const folder = makeFolder({ id: 'fo1', name: 'Docs', tags: [] });
		apiMock.tags.syncFolderTags.mockResolvedValueOnce([tag]);

		const { store } = setup([tag]);
		await store.saveFolderTags(folder, ['t1']);

		expect(apiMock.tags.syncFolderTags).toHaveBeenCalledWith('lib-1', 'fo1', { tagIds: ['t1'] });
		expect(folder.tags).toEqual([tag]);
	});

	it('syncDraftNames seeds drafts and drops removed tags', () => {
		const t1 = makeTag({ id: 't1', name: 'One' });
		const t2 = makeTag({ id: 't2', name: 'Two' });
		let tags = [t1, t2];
		const store = createLibraryTags(
			() => 'lib-1',
			() => tags,
			(next) => {
				tags = next;
			},
			() => []
		);

		store.syncDraftNames();
		expect(store.tagDraftNames).toEqual({ t1: 'One', t2: 'Two' });

		// Remove t2 and add a new tag; re-sync should drop t2 and seed the new one.
		tags = [t1, makeTag({ id: 't3', name: 'Three' })];
		store.syncDraftNames();
		expect(store.tagDraftNames).toEqual({ t1: 'One', t3: 'Three' });
	});

	it('saveDraftTagName renames using draft value', async () => {
		const tag = makeTag({ id: 't1', name: 'Old' });
		const updated = makeTag({ id: 't1', name: 'Draft Name' });
		apiMock.tags.update.mockResolvedValueOnce(updated);

		const { store } = setup([tag]);
		store.syncDraftNames();
		store.tagDraftNames['t1'] = 'Draft Name';

		await store.saveDraftTagName(tag);

		expect(apiMock.tags.update).toHaveBeenCalledWith('lib-1', 't1', { name: 'Draft Name' });
	});

	it('saveDraftTagName falls back to the tag name when no draft exists', async () => {
		const tag = makeTag({ id: 't1', name: 'Old' });
		const { store } = setup([tag]);

		// No draft seeded and name unchanged → renameTag short-circuits.
		await store.saveDraftTagName(tag);
		expect(apiMock.tags.update).not.toHaveBeenCalled();
	});

	it('updateTagColor does nothing when color is the same', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag', color: '#E11D48' });
		const { store } = setup([tag]);

		await store.updateTagColor(tag, '#e11d48');
		expect(apiMock.tags.update).not.toHaveBeenCalled();
	});

	it('updateTagColor calls api when color differs', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag', color: '#E11D48' });
		const updated = makeTag({ id: 't1', name: 'Tag', color: '#3B82F6' });
		apiMock.tags.update.mockResolvedValueOnce(updated);

		const { store, getTags } = setup([tag]);

		await store.updateTagColor(tag, '#3B82F6');

		expect(apiMock.tags.update).toHaveBeenCalledWith('lib-1', 't1', { color: '#3B82F6' });
		expect(getTags()[0]!.color).toBe('#3B82F6');
	});

	it('updateTagColor shows toast on error', async () => {
		const tag = makeTag({ id: 't1', name: 'Tag', color: '#E11D48' });
		apiMock.tags.update.mockRejectedValueOnce(new Error('fail'));

		const { store } = setup([tag]);
		await store.updateTagColor(tag, '#3B82F6');

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to update tag color',
			color: 'error'
		});
	});
});
