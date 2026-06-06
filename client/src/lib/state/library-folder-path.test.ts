import { describe, it, expect, beforeEach } from 'vitest';
import { libraryFolderPath } from './library-folder-path.svelte';
import type { FolderBreadcrumb } from '$lib/types/api';

const crumbs = (...ids: string[]): FolderBreadcrumb[] =>
	ids.map((id) => ({ id, name: `Folder ${id}` }));

describe('libraryFolderPath', () => {
	beforeEach(() => libraryFolderPath.clear());

	it('starts empty', () => {
		expect(libraryFolderPath.value).toEqual([]);
	});

	it('publishes the folder ancestry via set', () => {
		const path = crumbs('a', 'b');
		libraryFolderPath.set(path);
		expect(libraryFolderPath.value).toEqual(path);
	});

	it('replaces the ancestry on a subsequent set (does not merge)', () => {
		libraryFolderPath.set(crumbs('a', 'b'));
		libraryFolderPath.set(crumbs('c'));
		expect(libraryFolderPath.value).toEqual(crumbs('c'));
	});

	it('clear resets the ancestry to empty', () => {
		libraryFolderPath.set(crumbs('a', 'b', 'c'));
		expect(libraryFolderPath.value).toHaveLength(3);
		libraryFolderPath.clear();
		expect(libraryFolderPath.value).toEqual([]);
	});

	it('is a shared singleton: reads observe writes from elsewhere', () => {
		const path = crumbs('shared');
		libraryFolderPath.set(path);
		// A different consumer importing the same module sees the same value.
		expect(libraryFolderPath.value).toBe(path);
	});

	it('can be set to an empty array directly', () => {
		libraryFolderPath.set(crumbs('a'));
		libraryFolderPath.set([]);
		expect(libraryFolderPath.value).toEqual([]);
	});
});
