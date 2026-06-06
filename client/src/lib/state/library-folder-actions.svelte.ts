import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import type { LibraryFolder } from '$lib/types/api';

type RefreshFoldersFn = () => Promise<LibraryFolder[]>;
type AsyncVoidFn = () => Promise<void>;

export interface MoveDestinationOption {
	label: string;
	value: string;
}

export const ROOT_MOVE_VALUE = '__root__';

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
			if (descendants.has(child.id)) continue;
			descendants.add(child.id);
			stack.push(child.id);
		}
	}

	return descendants;
}

function buildFolderLabel(folder: LibraryFolder, folderMap: Map<string, LibraryFolder>): string {
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
 * Folder create / move / delete actions for a single library, ported from the
 * Nuxt `useLibraryFolderActions` composable.
 *
 * Reactive inputs are passed as getters (the Vue version took `Ref<string>` /
 * `Ref<string | null>`): `getLibraryId` and `getCurrentFolderId` are read lazily
 * inside the methods. The three callbacks (`refreshFolders`, `resetAndFetch`,
 * `refreshTrashedCount`) are supplied by the consuming component.
 *
 * Modal-state flags and the move-destination derivation are exposed via getters
 * so reactivity survives the function boundary; writable flags also expose
 * setters so callers/tests can drive them like the old refs.
 */
export function createLibraryFolderActions(
	getLibraryId: () => string,
	getCurrentFolderId: () => string | null,
	refreshFolders: RefreshFoldersFn,
	resetAndFetch: AsyncVoidFn,
	refreshTrashedCount: AsyncVoidFn
) {
	let createFolderOpen = $state(false);
	let createFolderName = $state('');
	let creatingFolder = $state(false);

	let moveFolderOpen = $state(false);
	let movingFolder = $state<LibraryFolder | null>(null);
	let moveDestinationValue = $state<string>(ROOT_MOVE_VALUE);
	let moveLoading = $state(false);
	let moveFolderSaving = $state(false);
	let allFolders = $state<LibraryFolder[]>([]);

	const moveDestinationOptions = $derived.by<MoveDestinationOption[]>(() => {
		const base: MoveDestinationOption[] = [{ label: 'Root', value: ROOT_MOVE_VALUE }];
		const targetFolder = movingFolder;
		if (!targetFolder) return base;

		const excluded = collectDescendantIds(targetFolder.id, allFolders);
		excluded.add(targetFolder.id);

		const folderMap = new Map(allFolders.map((folder) => [folder.id, folder]));

		const options = allFolders
			.filter((folder) => !excluded.has(folder.id))
			.map((folder) => ({
				label: buildFolderLabel(folder, folderMap),
				value: folder.id
			}))
			.sort((a, b) => a.label.localeCompare(b.label));

		return [...base, ...options];
	});

	function openCreateFolderModal() {
		createFolderName = '';
		createFolderOpen = true;
	}

	async function createFolder() {
		const name = createFolderName.trim();
		if (!name) return;

		creatingFolder = true;
		try {
			await api.folders.create(getLibraryId(), { name, parentFolderId: getCurrentFolderId() });
			createFolderOpen = false;
			createFolderName = '';
			await resetAndFetch();
		} catch {
			toast.add({ title: 'Failed to create folder', color: 'error' });
		} finally {
			creatingFolder = false;
		}
	}

	async function openMoveFolderModal(folder: LibraryFolder) {
		movingFolder = folder;
		moveDestinationValue = folder.parentFolderId ?? ROOT_MOVE_VALUE;
		moveFolderOpen = true;

		moveLoading = true;
		try {
			allFolders = await refreshFolders();
		} catch {
			toast.add({ title: 'Failed to load folders', color: 'error' });
		} finally {
			moveLoading = false;
		}
	}

	async function moveFolder() {
		if (!movingFolder) return;

		moveFolderSaving = true;
		try {
			const parentFolderId = moveDestinationValue === ROOT_MOVE_VALUE ? null : moveDestinationValue;

			await api.folders.move(getLibraryId(), movingFolder.id, { parentFolderId });

			moveFolderOpen = false;
			await resetAndFetch();
		} catch {
			toast.add({ title: 'Failed to move folder', color: 'error' });
		} finally {
			moveFolderSaving = false;
		}
	}

	async function deleteFolders(folderIds: string[]) {
		try {
			await Promise.all(folderIds.map((folderId) => api.folders.delete(getLibraryId(), folderId)));
			await Promise.all([resetAndFetch(), refreshTrashedCount()]);
		} catch {
			toast.add({ title: 'Failed to delete folder', color: 'error' });
		}
	}

	async function deleteFolder(folder: LibraryFolder) {
		await deleteFolders([folder.id]);
	}

	return {
		get createFolderOpen() {
			return createFolderOpen;
		},
		set createFolderOpen(value: boolean) {
			createFolderOpen = value;
		},
		get createFolderName() {
			return createFolderName;
		},
		set createFolderName(value: string) {
			createFolderName = value;
		},
		get creatingFolder() {
			return creatingFolder;
		},
		get moveFolderOpen() {
			return moveFolderOpen;
		},
		set moveFolderOpen(value: boolean) {
			moveFolderOpen = value;
		},
		get movingFolder() {
			return movingFolder;
		},
		set movingFolder(value: LibraryFolder | null) {
			movingFolder = value;
		},
		get moveDestinationValue() {
			return moveDestinationValue;
		},
		set moveDestinationValue(value: string) {
			moveDestinationValue = value;
		},
		get moveLoading() {
			return moveLoading;
		},
		get moveFolderSaving() {
			return moveFolderSaving;
		},
		get allFolders() {
			return allFolders;
		},
		get moveDestinationOptions() {
			return moveDestinationOptions;
		},
		openCreateFolderModal,
		createFolder,
		openMoveFolderModal,
		moveFolder,
		deleteFolders,
		deleteFolder
	};
}
