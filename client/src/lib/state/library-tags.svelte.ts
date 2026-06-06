import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import { isTagColorInPalette, TAG_COLOR_PALETTE } from '$lib/shared/tag-colors';
import type { LibraryFile, LibraryFolder, LibraryTag } from '$lib/types/api';

/**
 * Tag CRUD + assignment to files/folders + color logic, ported from the Nuxt
 * `useLibraryTags` composable.
 *
 * The consuming component owns the reactive `libraryTags` and `files` arrays.
 * They are read through getter functions (`getLibraryId`, `getLibraryTags`,
 * `getFiles`) so reactivity survives the function boundary, and the store
 * reassigns the tag list through the `setLibraryTags` callback the component
 * provides (mirroring the old `libraryTags.value = ...`). Individual file/folder
 * `tags` arrays are mutated in place on the objects, exactly like the original.
 *
 * `createTagName` / `creatingTag` are local UI state exposed via getters; the
 * draft-name map (`tagDraftNames`) replaces the Vue `watch(libraryTags)` with an
 * explicit `syncDraftNames()` method the component calls when the tag list
 * changes (no `$effect` inside the store, per the porting guide).
 */
export function createLibraryTags(
	getLibraryId: () => string,
	getLibraryTags: () => LibraryTag[],
	setLibraryTags: (tags: LibraryTag[]) => void,
	getFiles: () => LibraryFile[]
) {
	let createTagName = $state('');
	let creatingTag = $state(false);
	const tagDraftNames = $state<Record<string, string>>({});

	/**
	 * Reconcile the draft-name map with the current tag list: drop drafts for
	 * removed tags and (re)seed every present tag's draft to its name. Replaces
	 * the old `watch(libraryTags, …, { immediate: true })`; the component calls
	 * this on mount and whenever the tag list changes.
	 */
	function syncDraftNames() {
		const nextTags = getLibraryTags();

		const keepIds = new Set(nextTags.map((tag) => tag.id));
		for (const id of Object.keys(tagDraftNames)) {
			if (!keepIds.has(id)) {
				delete tagDraftNames[id];
			}
		}
		for (const tag of nextTags) {
			tagDraftNames[tag.id] = tag.name;
		}
	}

	async function saveFileTags(file: LibraryFile, tagIds: string[]) {
		const result = await api.tags.syncFileTags(getLibraryId(), file.id, { tagIds });
		file.tags = result.tags;
	}

	async function saveFolderTags(folder: LibraryFolder, tagIds: string[]) {
		const result = await api.tags.syncFolderTags(getLibraryId(), folder.id, { tagIds });
		folder.tags = result.tags;
	}

	function isTagAssigned(file: LibraryFile, tagId: string): boolean {
		return file.tags.some((tag) => tag.id === tagId);
	}

	function isFolderTagAssigned(folder: LibraryFolder, tagId: string): boolean {
		return folder.tags.some((tag) => tag.id === tagId);
	}

	function areAllFilesTagged(fileIds: string[], tagId: string): boolean {
		const files = getFiles();
		return fileIds.every((id) => {
			const file = files.find((item) => item.id === id);
			return file ? isTagAssigned(file, tagId) : false;
		});
	}

	async function toggleTagForFolder(folder: LibraryFolder, tagId: string) {
		const nextTagIds = new Set(folder.tags.map((tag) => tag.id));
		if (isFolderTagAssigned(folder, tagId)) {
			nextTagIds.delete(tagId);
		} else {
			nextTagIds.add(tagId);
		}

		try {
			await saveFolderTags(folder, [...nextTagIds]);
		} catch {
			toast.add({ title: 'Failed to update folder tags', color: 'error' });
		}
	}

	async function toggleTagForFiles(fileIds: string[], tagId: string) {
		const targetFiles = getFiles().filter((file) => fileIds.includes(file.id));
		if (!targetFiles.length) return;

		const shouldAddTag = !targetFiles.every((file) => isTagAssigned(file, tagId));

		try {
			await Promise.all(
				targetFiles.map((file) => {
					const nextTagIds = new Set(file.tags.map((tag) => tag.id));
					if (shouldAddTag) {
						nextTagIds.add(tagId);
					} else {
						nextTagIds.delete(tagId);
					}
					return saveFileTags(file, [...nextTagIds]);
				})
			);
		} catch {
			toast.add({ title: 'Failed to update file tags', color: 'error' });
		}
	}

	async function createTag(color?: string) {
		const name = createTagName.trim();
		if (!name) return;
		creatingTag = true;
		try {
			const normalizedColor = color?.trim().toUpperCase();
			const tag = await api.tags.create(
				getLibraryId(),
				normalizedColor ? { name, color: normalizedColor } : { name }
			);
			setLibraryTags([...getLibraryTags(), tag].sort((a, b) => a.name.localeCompare(b.name)));
			createTagName = '';
		} catch {
			toast.add({ title: 'Failed to create tag', color: 'error' });
		} finally {
			creatingTag = false;
		}
	}

	async function updateTagColor(tag: LibraryTag, color: string) {
		const normalized = color.trim().toUpperCase();
		if (normalized === tag.color.toUpperCase()) return;

		try {
			const updated = await api.tags.update(getLibraryId(), tag.id, { color: normalized });
			replaceTag(updated);
		} catch {
			toast.add({ title: 'Failed to update tag color', color: 'error' });
		}
	}

	function getTagColorChoices(tag: LibraryTag): string[] {
		const normalized = tag.color.trim().toUpperCase();
		if (isTagColorInPalette(normalized)) return [...TAG_COLOR_PALETTE];
		return [normalized, ...TAG_COLOR_PALETTE];
	}

	function isTagColorUsedByAnotherTag(tagId: string, color: string): boolean {
		const normalized = color.toUpperCase();
		return getLibraryTags().some(
			(tag) => tag.id !== tagId && tag.color.toUpperCase() === normalized
		);
	}

	function selectTagColor(tag: LibraryTag, color: string) {
		updateTagColor(tag, color);
	}

	async function renameTag(tag: LibraryTag, nextName: string) {
		const name = nextName.trim();
		if (!name || name === tag.name) return;
		try {
			const updated = await api.tags.update(getLibraryId(), tag.id, { name });
			replaceTag(updated);
		} catch {
			toast.add({ title: 'Failed to rename tag', color: 'error' });
		}
	}

	async function saveDraftTagName(tag: LibraryTag) {
		await renameTag(tag, tagDraftNames[tag.id] ?? tag.name);
	}

	async function deleteTag(tagId: string) {
		try {
			await api.tags.delete(getLibraryId(), tagId);
			setLibraryTags(getLibraryTags().filter((tag) => tag.id !== tagId));
			for (const file of getFiles()) {
				file.tags = file.tags.filter((tag) => tag.id !== tagId);
			}
		} catch {
			toast.add({ title: 'Failed to delete tag', color: 'error' });
		}
	}

	function replaceTag(updated: LibraryTag) {
		setLibraryTags(
			getLibraryTags()
				.map((tag) => (tag.id === updated.id ? updated : tag))
				.sort((a, b) => a.name.localeCompare(b.name))
		);

		for (const file of getFiles()) {
			file.tags = file.tags
				.map((tag) => (tag.id === updated.id ? updated : tag))
				.sort((a, b) => a.name.localeCompare(b.name));
		}
	}

	return {
		get createTagName() {
			return createTagName;
		},
		set createTagName(value: string) {
			createTagName = value;
		},
		get creatingTag() {
			return creatingTag;
		},
		get tagDraftNames() {
			return tagDraftNames;
		},
		syncDraftNames,
		saveFileTags,
		saveFolderTags,
		isTagAssigned,
		isFolderTagAssigned,
		areAllFilesTagged,
		toggleTagForFolder,
		toggleTagForFiles,
		createTag,
		updateTagColor,
		getTagColorChoices,
		isTagColorUsedByAnotherTag,
		selectTagColor,
		renameTag,
		saveDraftTagName,
		deleteTag,
		replaceTag
	};
}
