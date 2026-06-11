import { describe, it, expect } from 'vitest';
import {
	ROOT_MOVE_VALUE,
	buildFolderLabel,
	buildMoveDestinationOptions,
	collectDescendantIds
} from './folder-tree';
import type { LibraryFolder } from '$lib/types/api';

function makeFolder(id: string, name: string, parentFolderId: string | null = null): LibraryFolder {
	return {
		id,
		libraryId: 'lib-1',
		name,
		parentFolderId,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z'
	} as LibraryFolder;
}

describe('collectDescendantIds', () => {
	const tree = [
		makeFolder('a', 'A'),
		makeFolder('b', 'B', 'a'),
		makeFolder('c', 'C', 'b'),
		makeFolder('d', 'D', 'a'),
		makeFolder('e', 'E') // sibling root, unrelated
	];

	it('collects nested descendants at every depth, excluding the root itself', () => {
		expect(collectDescendantIds('a', tree)).toEqual(new Set(['b', 'c', 'd']));
		expect(collectDescendantIds('b', tree)).toEqual(new Set(['c']));
	});

	it('returns an empty set for a leaf or unknown folder', () => {
		expect(collectDescendantIds('c', tree)).toEqual(new Set());
		expect(collectDescendantIds('nope', tree)).toEqual(new Set());
	});

	it('tolerates a cycle without re-including the root', () => {
		const cyclic = [makeFolder('x', 'X', 'y'), makeFolder('y', 'Y', 'x')];
		expect(collectDescendantIds('x', cyclic)).toEqual(new Set(['y']));
	});
});

describe('buildFolderLabel', () => {
	it('renders the full path from the top-most ancestor', () => {
		const folders = [makeFolder('a', 'A'), makeFolder('b', 'B', 'a'), makeFolder('c', 'C', 'b')];
		const map = new Map(folders.map((f) => [f.id, f]));
		expect(buildFolderLabel(folders[2], map)).toBe('A / B / C');
	});

	it('stops at a missing parent and at the depth guard', () => {
		const orphan = makeFolder('o', 'Orphan', 'gone');
		expect(buildFolderLabel(orphan, new Map([[orphan.id, orphan]]))).toBe('Orphan');

		const selfParent = makeFolder('s', 'Loop', 's');
		const label = buildFolderLabel(selfParent, new Map([[selfParent.id, selfParent]]));
		expect(label.split(' / ').length).toBeLessThanOrEqual(101);
	});
});

describe('buildMoveDestinationOptions', () => {
	const folders = [makeFolder('a', 'Zoo'), makeFolder('b', 'Alpha'), makeFolder('c', 'Kid', 'b')];

	it('puts Root first, labels with full paths, and sorts alphabetically', () => {
		expect(buildMoveDestinationOptions(folders)).toEqual([
			{ label: 'Root', value: ROOT_MOVE_VALUE },
			{ label: 'Alpha', value: 'b' },
			{ label: 'Alpha / Kid', value: 'c' },
			{ label: 'Zoo', value: 'a' }
		]);
	});

	it('omits excluded ids (a folder cannot move into itself or its descendants)', () => {
		const excluded = collectDescendantIds('b', folders);
		excluded.add('b');
		expect(buildMoveDestinationOptions(folders, excluded)).toEqual([
			{ label: 'Root', value: ROOT_MOVE_VALUE },
			{ label: 'Zoo', value: 'a' }
		]);
	});

	it('returns only Root for an empty folder list', () => {
		expect(buildMoveDestinationOptions([])).toEqual([{ label: 'Root', value: ROOT_MOVE_VALUE }]);
	});
});
