import type { LibraryFolder } from '$lib/types/api';

/** Sentinel option value meaning "move to the library root" (no parent folder). */
export const ROOT_MOVE_VALUE = '__root__';

export interface MoveDestinationOption {
	label: string;
	value: string;
}

/**
 * Collect the ids of every folder nested (at any depth) under `rootId`.
 * The result never includes `rootId` itself; cycles in the parent graph are
 * tolerated (each folder is visited at most once).
 */
export function collectDescendantIds(rootId: string, folders: LibraryFolder[]): Set<string> {
	// Transient local collections used only for traversal (not reactive state).

	const children = new Map<string | null, LibraryFolder[]>();
	for (const folder of folders) {
		const key = folder.parentFolderId;
		const list = children.get(key) ?? [];
		list.push(folder);
		children.set(key, list);
	}

	const descendants = new Set<string>();
	const stack = [rootId];

	while (stack.length) {
		const current = stack.pop()!;
		const directChildren = children.get(current) ?? [];
		for (const child of directChildren) {
			// The id guard keeps the "never includes rootId" contract even if the
			// parent graph somehow contains a cycle back to the root.
			if (child.id === rootId || descendants.has(child.id)) continue;
			descendants.add(child.id);
			stack.push(child.id);
		}
	}

	return descendants;
}

/**
 * Render a folder's full path ("Grandparent / Parent / Name") by walking up the
 * parent chain. The guard caps pathological depth (or a cycle) at 100 hops.
 */
export function buildFolderLabel(
	folder: LibraryFolder,
	folderMap: Map<string, LibraryFolder>
): string {
	const parts: string[] = [folder.name];
	let current = folder.parentFolderId;
	let guard = 0;

	while (current && guard < 100) {
		const parent = folderMap.get(current);
		if (!parent) break;
		parts.unshift(parent.name);
		current = parent.parentFolderId;
		guard++;
	}

	return parts.join(' / ');
}

/**
 * Build the option list for a move-destination picker: "Root" first, then every
 * eligible folder labelled with its full path, sorted alphabetically. Pass
 * `excludeIds` to omit ineligible targets (e.g. a folder being moved plus its
 * descendants — a folder cannot be moved into itself).
 */
export function buildMoveDestinationOptions(
	folders: LibraryFolder[],
	excludeIds?: Set<string>
): MoveDestinationOption[] {
	const base: MoveDestinationOption[] = [{ label: 'Root', value: ROOT_MOVE_VALUE }];
	const folderMap = new Map(folders.map((folder) => [folder.id, folder]));

	const options = folders
		.filter((folder) => !excludeIds?.has(folder.id))
		.map((folder) => ({ label: buildFolderLabel(folder, folderMap), value: folder.id }))
		.sort((a, b) => a.label.localeCompare(b.label));

	return [...base, ...options];
}
