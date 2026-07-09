<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api, apiUrl } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import { toast } from '$lib/state/toast';
	import { canManageLibrary as canManageLibraryFn } from '$lib/utils/permissions';
	import { portal } from '$lib/actions/portal';
	import { libraryFolderPath } from '$lib/state/library-folder-path.svelte';
	import { createLibraryExplorer } from '$lib/state/library-explorer.svelte';
	import { createLibraryTags } from '$lib/state/library-tags.svelte';
	import { createDownloadZip } from '$lib/state/download-zip.svelte';
	import { createLibraryFolderActions } from '$lib/state/library-folder-actions.svelte';
	import { createLibraryDocumentActions } from '$lib/state/library-document-actions.svelte';
	import { isMarkdownFile } from '$lib/utils/markdown-file';
	import {
		ROOT_MOVE_VALUE,
		buildMoveDestinationOptions,
		collectDescendantIds
	} from '$lib/utils/folder-tree';
	import { uploadQueue } from '$lib/state/upload-queue.svelte';
	import { createFileDrop } from '$lib/state/file-drop.svelte';
	import type { AuthUser, Library, LibraryEntry, LibraryFile, LibraryFolder } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import AppModal from '$lib/components/ui/AppModal.svelte';
	import UploadModal from '$lib/components/UploadModal.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';
	import LibraryEntriesGrid from '$lib/components/library/LibraryEntriesGrid.svelte';
	import LibraryEntriesTable from '$lib/components/library/LibraryEntriesTable.svelte';
	import LibraryEntriesSkeleton from '$lib/components/library/LibraryEntriesSkeleton.svelte';
	import LibraryEmptyState from '$lib/components/library/LibraryEmptyState.svelte';

	/**
	 * The shared library file browser, ported from the Nuxt
	 * `pages/libraries/[id]/index.vue`. The `trashed` prop selects between the
	 * normal Files view and the Trash view (the old `/libraries/:id/trash` route
	 * alias). It drives the library-explorer + folder-actions + tags + upload-queue
	 * + file-drop stores, the grid/table views, selection, context menus, and the
	 * create-folder / move / delete / purge modals.
	 */
	interface Props {
		library: Library | null | undefined;
		user: AuthUser | null | undefined;
		trashed?: boolean;
	}

	let { library, user, trashed = false }: Props = $props();

	const ENTRY_VIEW_STORAGE_KEY = 'alcoves.library.entry-view';

	const libraryId = $derived(page.params.id ?? '');
	const currentFolderId = $derived(trashed ? null : (page.url.searchParams.get('folder') ?? null));
	const canManageLibrary = $derived(canManageLibraryFn(library, user));

	// Explorer store — route-derived inputs are passed as getters. Trash mode is a
	// prop, so `getIsTrashRoute` mirrors it.
	const explorer = createLibraryExplorer(
		() => libraryId,
		() => currentFolderId,
		() => trashed
	);

	// Keep the explorer's internal view mode in sync with the `trashed` prop.
	$effect(() => {
		explorer.viewMode = trashed ? 'trash' : 'files';
	});

	const tags = createLibraryTags(
		() => libraryId,
		() => explorer.libraryTags,
		(next) => (explorer.libraryTags = next),
		() => explorer.files
	);

	const zip = createDownloadZip(() => libraryId);

	const folderActions = createLibraryFolderActions(
		() => libraryId,
		() => currentFolderId,
		() => explorer.refreshFolders(),
		() => explorer.resetAndFetch(),
		() => explorer.refreshTrashedCount()
	);

	const documentActions = createLibraryDocumentActions(
		() => libraryId,
		() => currentFolderId
	);

	// ── Local UI state ──────────────────────────────────────────────────────────
	let renamingEntry = $state<LibraryEntry | null>(null);
	let renameValue = $state('');
	let uploadOpen = $state(false);

	let previewFile = $state<LibraryFile | null>(null);
	let previewOpen = $state(false);

	let draggedFileIds = $state<string[]>([]);
	let draggedFolderIds = $state<string[]>([]);
	// The full folder tree, loaded lazily when a folder drag begins so we can reject
	// dropping a folder into itself or one of its own descendants.
	let dragFolderTree = $state<LibraryFolder[]>([]);
	let dropTargetFolderId = $state<string | null>(null);
	const failedThumbnails = new Set<string>();

	const dragEnabled = $derived(canManageLibrary && !trashed);

	// Whether the mobile toolbar overflow trigger has anything to show. Mirrors
	// the union of the desktop toolbar's own `{#if}` conditions below so the
	// "More actions" button never opens onto an empty menu.
	const mobileToolbarHasItems = $derived(
		!trashed || (!explorer.filesPending && explorer.totalCount > 0)
	);

	// Move-files modal state
	let moveFilesOpen = $state(false);
	let moveFilesLoading = $state(false);
	let moveFilesSaving = $state(false);
	let moveFileIds = $state<string[]>([]);
	let moveFilesDestinationValue = $state<string>(ROOT_MOVE_VALUE);
	let moveFileFolders = $state<LibraryFolder[]>([]);

	// Purge (permanent delete) modal state
	let purgeModalOpen = $state(false);
	let purgeConfirmation = $state('');
	let filesToPurge = $state<string[]>([]);
	let foldersToPurge = $state<string[]>([]);
	let purgeAll = $state(false);

	// ── Context menu state ───────────────────────────────────────────────────────
	type ContextMenuItem = {
		label: string;
		icon?: string;
		color?: 'error';
		disabled?: boolean;
		children?: ContextMenuItem[];
		onSelect?: () => void;
	};

	let contextMenuOpen = $state(false);
	let contextMenuGroups = $state<ContextMenuItem[][]>([]);

	// Set (and reset) by the Trigger's own `oncontextmenu` handler below —
	// true for the duration of a single contextmenu event's dispatch when a
	// row/card claimed it via `showContextMenu` during the bubble phase. Not
	// `$state`: it's a synchronous, per-event bookkeeping flag, not UI state.
	let entryContextMenuHandled = false;

	// Once the menu closes, drop any leftover items so a future open (however
	// it's triggered) never briefly renders a previous entry's actions.
	$effect(() => {
		if (!contextMenuOpen) contextMenuGroups = [];
	});

	// The row-level `oncontextmenu` handler (LibraryEntriesTable/Grid, via
	// `onrowContextMenu`) only computes which items apply for ITS entry and
	// marks the event as claimed; the actual open/position/dismiss behavior is
	// owned by the ContextMenu.Root that wraps the whole entries area below.
	// When there's nothing to show for a claimed entry (e.g. a read-only trash
	// view) we prevent the default so no menu opens at all, rather than
	// showing an empty one.
	function showContextMenu(entry: LibraryEntry, event: MouseEvent) {
		entryContextMenuHandled = true;
		contextMenuGroups = getContextMenuItems(entry);
		if (!contextMenuGroups.length) {
			event.preventDefault();
		}
	}

	// ── Folder path sync (published to the library header breadcrumb) ────────────
	$effect(() => {
		libraryFolderPath.set(trashed ? [] : explorer.breadcrumbs);
	});
	onDestroy(() => libraryFolderPath.clear());

	// ── Preview ──────────────────────────────────────────────────────────────────
	// Note: the ported FilePreview emits only `onnavigate` (no file-update event),
	// so unlike the Nuxt page there is no `@update:file` handler to wire here.
	function openPreview(file: LibraryFile) {
		previewFile = file;
		previewOpen = true;
	}

	function isImageFile(file: LibraryFile): boolean {
		return file.mimeType.startsWith('image/');
	}

	function isSmallImage(file: LibraryFile): boolean {
		return Boolean(file.width && file.height && file.width < 320 && file.height < 160);
	}

	// ── Rename ─────────────────────────────────────────────────────────────────
	function isRenaming(entry: LibraryEntry): boolean {
		return renamingEntry?.id === entry.id && renamingEntry?.kind === entry.kind;
	}

	async function startEntryRename(entry: LibraryEntry) {
		if (!canManageLibrary || trashed) return;
		renamingEntry = entry;
		renameValue = entry.name;
		await tick();
		requestAnimationFrame(() => {
			const input = document.querySelector<HTMLInputElement>(
				`[data-rename-input-entry-id="${entry.id}"] input`
			);
			input?.focus();
			if (entry.kind === 'file') {
				const lastDot = entry.name.lastIndexOf('.');
				const selectTo = lastDot > 0 ? lastDot : entry.name.length;
				input?.setSelectionRange(0, selectTo);
			} else {
				input?.setSelectionRange(0, entry.name.length);
			}
		});
	}

	async function saveEntryRename(entry: LibraryEntry) {
		if (!canManageLibrary) {
			renamingEntry = null;
			return;
		}
		const rawName = renameValue.trim();
		if (!rawName) {
			renamingEntry = null;
			return;
		}

		if (entry.kind === 'folder') {
			if (entry.name === rawName) {
				renamingEntry = null;
				return;
			}
			try {
				const updated = await api.folders.update(libraryId, entry.id, { name: rawName });
				entry.name = updated.name;
				entry.updatedAt = updated.updatedAt;
				explorer.breadcrumbs = explorer.breadcrumbs.map((crumb) =>
					crumb.id === updated.id ? { ...crumb, name: updated.name } : crumb
				);
			} catch {
				toast.add({ title: 'Failed to rename folder', color: 'error' });
			} finally {
				renamingEntry = null;
			}
			return;
		}

		const originalLastDot = entry.name.lastIndexOf('.');
		const originalExt = originalLastDot > 0 ? entry.name.slice(originalLastDot) : '';
		const hasExt = rawName.lastIndexOf('.') > 0;
		const nextName = !hasExt && originalExt ? `${rawName}${originalExt}` : rawName;

		if (entry.name === nextName) {
			renamingEntry = null;
			return;
		}
		try {
			await api.files.update(libraryId, entry.id, { name: nextName });
			entry.name = nextName;
		} catch {
			toast.add({ title: 'Failed to rename file', color: 'error' });
		} finally {
			renamingEntry = null;
		}
	}

	// ── Navigation / open ────────────────────────────────────────────────────────
	function openFolder(folderId: string) {
		const query = explorer.buildFolderQuery(folderId, Object.fromEntries(page.url.searchParams));
		const search = new URLSearchParams(query).toString();
		void goto(`/libraries/${libraryId}${search ? `?${search}` : ''}`);
	}

	function openDocument(entryId: string) {
		const from = currentFolderId ? `?from=${currentFolderId}` : '';
		void goto(`/libraries/${libraryId}/doc/${entryId}${from}`);
	}

	function openEntry(entry: LibraryEntry) {
		if (entry.kind === 'folder') {
			openFolder(entry.id);
			return;
		}
		// Markdown files ARE live documents — open the collaborative editor
		// (every role: viewers get the live read-only view). Trash keeps the
		// plain preview since trashed docs reject edits.
		if (!trashed && isMarkdownFile(entry.mimeType, entry.name)) {
			openDocument(entry.id);
			return;
		}
		openPreview(entry);
	}

	// ── Move files ────────────────────────────────────────────────────────────────
	// Files can move anywhere, so no destinations are excluded (unlike moving a
	// folder, which must exclude itself and its descendants).
	const moveFileDestinationOptions = $derived(buildMoveDestinationOptions(moveFileFolders));
	const moveFilesDestinationLabel = $derived(
		moveFileDestinationOptions.find((o) => o.value === moveFilesDestinationValue)?.label ??
			'Select destination'
	);

	const moveFileCount = $derived(moveFileIds.length);

	async function moveFilesToFolder(fileIds: string[], targetFolderId: string | null) {
		await Promise.all(
			fileIds.map((fileId) =>
				api.files.update(libraryId, fileId, { parentFolderId: targetFolderId })
			)
		);
	}

	async function openMoveFilesModal(fileIds: string[]) {
		if (!dragEnabled) return;
		const ids = Array.from(new Set(fileIds));
		if (!ids.length) return;

		moveFileIds = ids;
		const targetFiles = explorer.files.filter((file) => ids.includes(file.id));
		if (!targetFiles.length) return;

		const parentSet = new Set(targetFiles.map((file) => file.parentFolderId));
		const firstParentId = targetFiles[0]?.parentFolderId ?? null;
		moveFilesDestinationValue =
			parentSet.size === 1 && firstParentId ? firstParentId : ROOT_MOVE_VALUE;
		moveFilesOpen = true;

		moveFilesLoading = true;
		try {
			moveFileFolders = await explorer.refreshFolders();
		} catch {
			toast.add({ title: 'Failed to load folders', color: 'error' });
		} finally {
			moveFilesLoading = false;
		}
	}

	async function moveFiles() {
		if (!moveFileIds.length) return;
		moveFilesSaving = true;
		try {
			const parentFolderId =
				moveFilesDestinationValue === ROOT_MOVE_VALUE ? null : moveFilesDestinationValue;
			const fileIds = moveFileIds.filter((fileId) => {
				const file = explorer.files.find((current) => current.id === fileId);
				if (!file) return false;
				return file.parentFolderId !== parentFolderId;
			});

			if (fileIds.length) {
				await moveFilesToFolder(fileIds, parentFolderId);
				await explorer.resetAndFetch();
				explorer.clearSelection();
				toast.add({
					title: fileIds.length === 1 ? 'File moved' : `${fileIds.length} files moved`,
					color: 'success'
				});
			}

			moveFilesOpen = false;
			moveFileIds = [];
			moveFilesDestinationValue = ROOT_MOVE_VALUE;
		} catch {
			toast.add({ title: 'Failed to move file(s)', color: 'error' });
		} finally {
			moveFilesSaving = false;
		}
	}

	function closeMoveFilesModal() {
		moveFilesOpen = false;
		moveFileIds = [];
		moveFilesDestinationValue = ROOT_MOVE_VALUE;
	}

	// ── Drag & drop (move files AND folders into folders) ─────────────────────────
	function handleEntryDragStart(entry: LibraryEntry, event: DragEvent) {
		if (!dragEnabled || isRenaming(entry)) return;
		const inSelection =
			entry.kind === 'file'
				? explorer.selectedFiles.has(entry.id)
				: explorer.selectedFolders.has(entry.id);

		// Dragging a member of a multi-selection moves the whole selection (files +
		// folders); otherwise it moves just the grabbed entry.
		if (inSelection && explorer.selectedFiles.size + explorer.selectedFolders.size > 1) {
			draggedFileIds = [...explorer.selectedFiles];
			draggedFolderIds = [...explorer.selectedFolders];
		} else if (entry.kind === 'file') {
			draggedFileIds = [entry.id];
			draggedFolderIds = [];
		} else {
			draggedFileIds = [];
			draggedFolderIds = [entry.id];
		}

		event.dataTransfer?.setData('text/plain', [...draggedFileIds, ...draggedFolderIds].join(','));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';

		// Folders need the tree to validate drop targets (no self / descendant drops).
		if (draggedFolderIds.length) {
			void explorer
				.refreshFolders()
				.then((folders) => (dragFolderTree = folders))
				.catch(() => {});
		}
	}

	function handleEntryDragEnd() {
		draggedFileIds = [];
		draggedFolderIds = [];
		dragFolderTree = [];
		dropTargetFolderId = null;
	}

	// A folder can't be dropped onto itself or any of its own descendants; files can
	// land on any folder. Returns false while nothing is being dragged.
	function canDropOnFolder(targetFolderId: string): boolean {
		if (!draggedFileIds.length && !draggedFolderIds.length) return false;
		for (const folderId of draggedFolderIds) {
			if (folderId === targetFolderId) return false;
			if (
				dragFolderTree.length &&
				collectDescendantIds(folderId, dragFolderTree).has(targetFolderId)
			)
				return false;
		}
		return true;
	}

	function handleFolderDragEnter(entry: LibraryEntry) {
		if (!dragEnabled || entry.kind !== 'folder') return;
		dropTargetFolderId = canDropOnFolder(entry.id) ? entry.id : null;
	}

	function handleFolderDragOver(entry: LibraryEntry, event: DragEvent) {
		if (!dragEnabled || entry.kind !== 'folder') return;
		if (!canDropOnFolder(entry.id)) {
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			dropTargetFolderId = null;
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropTargetFolderId = entry.id;
	}

	function handleFolderDragLeave(entry: LibraryEntry, event: DragEvent) {
		if (entry.kind !== 'folder' || dropTargetFolderId !== entry.id) return;
		const currentTarget = event.currentTarget as Node | null;
		const relatedTarget = event.relatedTarget as Node | null;
		if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) return;
		dropTargetFolderId = null;
	}

	async function handleFolderDrop(entry: LibraryEntry, event: DragEvent) {
		event.preventDefault();
		if (!dragEnabled || entry.kind !== 'folder') return;

		const targetFolderId = entry.id;
		const fileIds = Array.from(new Set(draggedFileIds)).filter((fileId) => {
			const file = explorer.files.find((current) => current.id === fileId);
			return file ? file.parentFolderId !== targetFolderId : false;
		});

		// Folder moves need an authoritative tree to exclude self/descendants/no-ops.
		// Only fetch it when folders are actually being dragged (file-only drops keep
		// their original, single-request behavior).
		let folderIds: string[] = [];
		if (draggedFolderIds.length) {
			const folders = dragFolderTree.length ? dragFolderTree : await explorer.refreshFolders();
			folderIds = Array.from(new Set(draggedFolderIds)).filter((folderId) => {
				if (folderId === targetFolderId) return false;
				if (collectDescendantIds(folderId, folders).has(targetFolderId)) return false;
				const folder = folders.find((current) => current.id === folderId);
				return folder ? folder.parentFolderId !== targetFolderId : true;
			});
		}

		if (!fileIds.length && !folderIds.length) {
			handleEntryDragEnd();
			return;
		}
		try {
			await Promise.all([
				...(fileIds.length ? [moveFilesToFolder(fileIds, targetFolderId)] : []),
				...folderIds.map((folderId) =>
					api.folders.move(libraryId, folderId, { parentFolderId: targetFolderId })
				)
			]);
			explorer.clearSelection();
			await explorer.resetAndFetch();
			if (folderIds.length) await explorer.refreshFolders();
			const moved = fileIds.length + folderIds.length;
			toast.add({
				title: moved === 1 ? 'Moved 1 item' : `Moved ${moved} items`,
				color: 'success'
			});
		} catch {
			toast.add({ title: 'Failed to move item(s)', color: 'error' });
		} finally {
			handleEntryDragEnd();
		}
	}

	// ── Upload queue integration ──────────────────────────────────────────────────
	const UPLOAD_REFRESH_DEBOUNCE_MS = 3_000;
	let lastUploadRefreshAt = 0;
	let uploadRefreshTimer: ReturnType<typeof setTimeout> | null = null;

	function refreshAfterUploadDebounced() {
		const now = Date.now();
		const elapsed = now - lastUploadRefreshAt;
		if (elapsed >= UPLOAD_REFRESH_DEBOUNCE_MS && !uploadRefreshTimer) {
			lastUploadRefreshAt = now;
			void explorer.resetAndFetch({ silent: true });
			return;
		}
		if (uploadRefreshTimer) return;
		uploadRefreshTimer = setTimeout(
			() => {
				uploadRefreshTimer = null;
				lastUploadRefreshAt = Date.now();
				void explorer.resetAndFetch({ silent: true });
			},
			Math.max(UPLOAD_REFRESH_DEBOUNCE_MS - elapsed, 0)
		);
	}

	const canDropUpload = $derived(
		canManageLibrary && !trashed && draggedFileIds.length === 0 && draggedFolderIds.length === 0
	);

	const fileDrop = createFileDrop(
		{
			onDrop(droppedFiles) {
				uploadQueue.addFiles(droppedFiles, libraryId, library?.name ?? 'Library', currentFolderId);
				toast.add({
					title: `${droppedFiles.length} file${droppedFiles.length === 1 ? '' : 's'} added to upload queue`
				});
			}
		},
		() => canDropUpload
	);

	// ── Selection (row click with shift / ctrl-meta) ─────────────────────────────
	function handleRowClick(entry: LibraryEntry, event: MouseEvent) {
		event.preventDefault();
		const isShift = event.shiftKey;
		const isMultiSelect = event.ctrlKey || event.metaKey;

		const entryList = explorer.entries;
		const clickedIndex = entryList.findIndex((e) => e.id === entry.id && e.kind === entry.kind);
		if (clickedIndex === -1) return;

		if (isShift && explorer.lastClickedIndex !== null) {
			const anchor = explorer.lastClickedIndex;
			const start = Math.min(anchor, clickedIndex);
			const end = Math.max(anchor, clickedIndex);
			if (!isMultiSelect) {
				explorer.selectedFiles.clear();
				explorer.selectedFolders.clear();
			}
			for (let i = start; i <= end; i++) {
				const e = entryList[i]!;
				if (e.kind === 'file') explorer.selectedFiles.add(e.id);
				else explorer.selectedFolders.add(e.id);
			}
		} else if (isMultiSelect) {
			if (entry.kind === 'file') {
				if (explorer.selectedFiles.has(entry.id)) explorer.selectedFiles.delete(entry.id);
				else explorer.selectedFiles.add(entry.id);
			} else {
				if (explorer.selectedFolders.has(entry.id)) explorer.selectedFolders.delete(entry.id);
				else explorer.selectedFolders.add(entry.id);
			}
			explorer.lastClickedIndex = clickedIndex;
		} else {
			explorer.clearSelection();
			if (entry.kind === 'file') explorer.selectedFiles.add(entry.id);
			else explorer.selectedFolders.add(entry.id);
			explorer.lastClickedIndex = clickedIndex;
		}
	}

	// ── Downloads ──────────────────────────────────────────────────────────────
	function downloadFiles(ids: string[]) {
		if (ids.length > 1) {
			zip.startDownload(ids, []);
			return;
		}
		for (const fid of ids) {
			const link = document.createElement('a');
			link.href = apiUrl(`/api/libraries/${libraryId}/files/${fid}?inline=true`);
			link.download = '';
			link.click();
		}
	}

	function downloadFolders(folderIds: string[]) {
		zip.startDownload([], folderIds);
	}

	function downloadSelection(fileIds: string[], folderIds: string[]) {
		if (!fileIds.length && !folderIds.length) return;
		if (fileIds.length === 1 && !folderIds.length) {
			downloadFiles(fileIds);
			return;
		}
		zip.startDownload(fileIds, folderIds);
	}

	// ── Bulk transcribe / audio-detect ────────────────────────────────────────────
	async function runBulkAction(kind: 'transcribe' | 'audio-detect', fileIds: string[] | undefined) {
		const verb = kind === 'transcribe' ? 'Transcribe' : 'Audio detection';
		const apiCall =
			kind === 'transcribe'
				? api.files.bulkTranscribe(libraryId, fileIds)
				: api.files.bulkAudioDetect(libraryId, fileIds);
		try {
			const res = await apiCall;
			const skippedCount = Object.keys(res.skipped).length;
			if (res.enqueued.length === 0) {
				toast.add({
					title: `${verb}: nothing to queue`,
					description: skippedCount ? `${skippedCount} file(s) skipped.` : undefined,
					color: 'warning'
				});
				return;
			}
			toast.add({
				title: `${verb}: queued ${res.enqueued.length} file(s)`,
				description: skippedCount ? `Skipped ${skippedCount}` : undefined,
				color: 'success'
			});
		} catch (e) {
			toast.add({
				title: `${verb} failed`,
				description: e instanceof Error ? e.message : 'Unknown error',
				color: 'error'
			});
		}
	}

	// ── Trash / restore / purge ────────────────────────────────────────────────
	async function trashFiles(ids: string[]) {
		await api.files.delete(libraryId, ids[0]!, { fileIds: ids });
		ids.forEach((id) => explorer.selectedFiles.delete(id));
		explorer.entries = explorer.entries.filter(
			(entry) => !(entry.kind === 'file' && ids.includes(entry.id))
		);
		explorer.totalCount -= ids.length;
		explorer.trashedCount += ids.length;
	}

	async function restoreFiles(ids: string[]) {
		await api.files.restore(libraryId, { fileIds: ids });
		ids.forEach((id) => explorer.selectedFiles.delete(id));
		explorer.entries = explorer.entries.filter(
			(entry) => !(entry.kind === 'file' && ids.includes(entry.id))
		);
		explorer.totalCount -= ids.length;
		explorer.trashedCount -= ids.length;
	}

	async function restoreFolders(ids: string[]) {
		await api.folders.restore(libraryId, { folderIds: ids });
		await Promise.all([explorer.resetAndFetch(), explorer.refreshTrashedCount()]);
	}

	function openPurgeModal(ids: string[]) {
		purgeAll = false;
		filesToPurge = ids;
		foldersToPurge = [];
		purgeConfirmation = '';
		purgeModalOpen = true;
	}

	function openPurgeFolderModal(ids: string[]) {
		purgeAll = false;
		filesToPurge = [];
		foldersToPurge = ids;
		purgeConfirmation = '';
		purgeModalOpen = true;
	}

	function openPurgeAllModal() {
		purgeAll = true;
		filesToPurge = [];
		foldersToPurge = [];
		purgeConfirmation = '';
		purgeModalOpen = true;
	}

	async function handlePermanentDelete() {
		try {
			if (purgeAll) {
				const result = await api.files.purge(libraryId);
				explorer.entries = [];
				explorer.nextCursor = null;
				explorer.totalCount = 0;
				explorer.trashedCount = 0;
				toast.add({
					title: `${result.purged} ${result.purged === 1 ? 'item' : 'items'} permanently deleted`,
					color: 'success'
				});
			} else {
				const result = await api.files.purge(
					libraryId,
					foldersToPurge.length ? { folderIds: foldersToPurge } : { fileIds: filesToPurge }
				);
				await explorer.resetAndFetch();
				await explorer.refreshTrashedCount();
				toast.add({
					title: `${result.purged} ${result.purged === 1 ? 'item' : 'items'} permanently deleted`,
					color: 'success'
				});
			}
			purgeModalOpen = false;
			purgeConfirmation = '';
			filesToPurge = [];
			foldersToPurge = [];
			purgeAll = false;
		} catch (error) {
			toast.add({
				title: 'Failed to permanently delete items',
				description: error instanceof Error ? error.message : 'Unknown error',
				color: 'error'
			});
		}
	}

	// ── Context menu item builder (ported faithfully) ────────────────────────────
	function getContextMenuItems(entry: LibraryEntry): ContextMenuItem[][] {
		const isInSelection =
			entry.kind === 'file'
				? explorer.selectedFiles.has(entry.id)
				: explorer.selectedFolders.has(entry.id);

		const targetFileIds: string[] = isInSelection
			? [...explorer.selectedFiles]
			: entry.kind === 'file'
				? [entry.id]
				: [];
		const targetFolderIds: string[] = isInSelection
			? [...explorer.selectedFolders]
			: entry.kind === 'folder'
				? [entry.id]
				: [];
		const totalCount = targetFileIds.length + targetFolderIds.length;
		const isMulti = totalCount > 1;

		// ── Trash view ────────────────────────────────────────────────────────────
		if (trashed) {
			if (!canManageLibrary) return [];

			const restoreItems: ContextMenuItem[] = [];
			const purgeItems: ContextMenuItem[] = [];

			if (targetFileIds.length) {
				restoreItems.push({
					label: targetFileIds.length > 1 ? `Restore ${targetFileIds.length} files` : 'Restore',
					icon: ICONS.restore,
					onSelect: () => restoreFiles(targetFileIds)
				});
				purgeItems.push({
					label:
						targetFileIds.length > 1
							? `Permanently delete ${targetFileIds.length} files`
							: 'Permanently delete',
					icon: ICONS.trash,
					color: 'error',
					onSelect: () => openPurgeModal(targetFileIds)
				});
			}
			if (targetFolderIds.length) {
				restoreItems.push({
					label:
						targetFolderIds.length > 1
							? `Restore ${targetFolderIds.length} folders`
							: 'Restore folder',
					icon: ICONS.restore,
					onSelect: () => restoreFolders(targetFolderIds)
				});
				purgeItems.push({
					label:
						targetFolderIds.length > 1
							? `Permanently delete ${targetFolderIds.length} folders`
							: 'Permanently delete folder',
					icon: ICONS.trash,
					color: 'error',
					onSelect: () => openPurgeFolderModal(targetFolderIds)
				});
			}

			return [
				...(restoreItems.length ? [restoreItems] : []),
				...(purgeItems.length ? [purgeItems] : [])
			];
		}

		// ── Read-only viewer ─────────────────────────────────────────────────────
		if (!canManageLibrary) {
			return [
				[
					...(entry.kind === 'folder' && !isMulti
						? [{ label: 'Open', icon: ICONS.folder, onSelect: () => openFolder(entry.id) }]
						: []),
					{
						label:
							totalCount > 1
								? `Download ${totalCount} items as ZIP`
								: entry.kind === 'folder'
									? 'Download as ZIP'
									: 'Download',
						icon: ICONS.download,
						onSelect: () => downloadSelection(targetFileIds, targetFolderIds)
					}
				]
			];
		}

		// ── Multi-selection ─────────────────────────────────────────────────────
		if (isMulti) {
			const multiTagItems: ContextMenuItem[] = explorer.libraryTags.length
				? explorer.libraryTags.map((tag) => ({
						label: tag.name,
						icon: tags.areAllFilesTagged(targetFileIds, tag.id) ? ICONS.check : ICONS.tag,
						onSelect: () => tags.toggleTagForFiles(targetFileIds, tag.id)
					}))
				: [{ label: 'No tags yet', disabled: true }];

			return [
				[
					{
						label: `Download ${totalCount} items as ZIP`,
						icon: ICONS.download,
						onSelect: () => downloadSelection(targetFileIds, targetFolderIds)
					},
					...(targetFileIds.length
						? [
								{
									label: targetFileIds.length > 1 ? `Move ${targetFileIds.length} files` : 'Move',
									icon: ICONS.move,
									onSelect: () => openMoveFilesModal(targetFileIds)
								},
								{
									label: `Transcribe ${targetFileIds.length} file(s)`,
									icon: ICONS.transcript,
									onSelect: () => runBulkAction('transcribe', targetFileIds)
								},
								{
									label: `Detect audio in ${targetFileIds.length} file(s)`,
									icon: ICONS.audioDetect,
									onSelect: () => runBulkAction('audio-detect', targetFileIds)
								}
							]
						: []),
					{ label: 'Tags', icon: ICONS.tag, children: multiTagItems }
				],
				[
					{
						label: `Delete ${totalCount} items`,
						icon: ICONS.trash,
						color: 'error',
						onSelect: () => {
							if (targetFileIds.length) void trashFiles(targetFileIds);
							if (targetFolderIds.length) void folderActions.deleteFolders(targetFolderIds);
						}
					}
				]
			];
		}

		// ── Single folder ──────────────────────────────────────────────────────────
		if (entry.kind === 'folder') {
			const folderTagItems: ContextMenuItem[] = explorer.libraryTags.length
				? explorer.libraryTags.map((tag) => ({
						label: tag.name,
						icon: tags.isFolderTagAssigned(entry, tag.id) ? ICONS.check : ICONS.tag,
						onSelect: () => tags.toggleTagForFolder(entry, tag.id)
					}))
				: [{ label: 'No tags yet', disabled: true }];

			return [
				[
					{ label: 'Open', icon: ICONS.folder, onSelect: () => openFolder(entry.id) },
					{
						label: 'Download as ZIP',
						icon: ICONS.download,
						onSelect: () => downloadFolders([entry.id])
					},
					{ label: 'Rename', icon: ICONS.edit, onSelect: () => startEntryRename(entry) },
					{
						label: 'Move',
						icon: ICONS.move,
						onSelect: () => folderActions.openMoveFolderModal(entry)
					},
					{ label: 'Tags', icon: ICONS.tag, children: folderTagItems }
				],
				[
					{
						label: 'Delete folder',
						icon: ICONS.trash,
						color: 'error',
						onSelect: () => folderActions.deleteFolder(entry)
					}
				]
			];
		}

		// ── Single file ──────────────────────────────────────────────────────────
		const tagItems: ContextMenuItem[] = explorer.libraryTags.length
			? explorer.libraryTags.map((tag) => ({
					label: tag.name,
					icon: tags.areAllFilesTagged([entry.id], tag.id) ? ICONS.check : ICONS.tag,
					onSelect: () => tags.toggleTagForFiles([entry.id], tag.id)
				}))
			: [{ label: 'No tags yet', disabled: true }];

		return [
			[
				{ label: 'Download', icon: ICONS.download, onSelect: () => downloadFiles([entry.id]) },
				{ label: 'Move', icon: ICONS.move, onSelect: () => openMoveFilesModal([entry.id]) },
				{ label: 'Rename', icon: ICONS.edit, onSelect: () => startEntryRename(entry) },
				...(entry.mimeType.startsWith('video/') || entry.mimeType.startsWith('audio/')
					? [
							{
								label: 'Editor',
								icon: ICONS.video,
								onSelect: () => {
									const from = currentFolderId ? `?from=${currentFolderId}` : '';
									void goto(`/libraries/${libraryId}/edit/${entry.id}${from}`);
								}
							}
						]
					: []),
				...(isMarkdownFile(entry.mimeType, entry.name)
					? [
							{
								label: 'Open document',
								icon: ICONS.edit,
								onSelect: () => openDocument(entry.id)
							}
						]
					: []),
				...(entry.mimeType.startsWith('video/') || entry.mimeType.startsWith('audio/')
					? [
							{
								label: 'Transcribe',
								icon: ICONS.transcript,
								onSelect: () => runBulkAction('transcribe', [entry.id])
							},
							{
								label: 'Detect audio',
								icon: ICONS.audioDetect,
								onSelect: () => runBulkAction('audio-detect', [entry.id])
							}
						]
					: []),
				{ label: 'Tags', icon: ICONS.tag, children: tagItems }
			],
			[
				{
					label: 'Delete',
					icon: ICONS.trash,
					color: 'error',
					onSelect: () => trashFiles([entry.id])
				}
			]
		];
	}

	// ── Empty-state copy ───────────────────────────────────────────────────────
	const emptyStateTitle = $derived.by(() => {
		if (trashed) return 'Trash is empty';
		if (currentFolderId) return 'This folder is empty';
		return 'No files or folders yet';
	});

	const emptyStateDescription = $derived.by(() => {
		if (trashed) return 'Deleted files will appear here';
		if (currentFolderId) return 'Create a folder or upload files to this location';
		return 'Upload files or create folders to get started with your library';
	});

	const purgeFileCount = $derived(
		purgeAll ? explorer.totalCount : filesToPurge.length + foldersToPurge.length
	);

	const moveFolderDestinationLabel = $derived(
		folderActions.moveDestinationOptions.find((o) => o.value === folderActions.moveDestinationValue)
			?.label ?? 'Select destination'
	);

	// The download-zip store exposes `showSizeWarning` read-only (closing it goes
	// through cancel/confirm). AppModal needs a two-way `open`, so mirror the store
	// flag into local state and route any modal-driven close to cancelLargeDownload.
	let sizeWarningOpen = $state(false);
	$effect(() => {
		if (zip.showSizeWarning && !sizeWarningOpen) {
			sizeWarningOpen = true;
		} else if (!zip.showSizeWarning && sizeWarningOpen) {
			sizeWarningOpen = false;
		}
	});
	$effect(() => {
		// Modal dismissed (backdrop/escape) while the store still thinks it's open.
		if (!sizeWarningOpen && zip.showSizeWarning) {
			zip.cancelLargeDownload();
		}
	});

	// ── Infinite scroll + initial load + lifecycle ────────────────────────────────
	let sentinel = $state<HTMLElement | null>(null);

	onMount(() => {
		const stored = localStorage.getItem(ENTRY_VIEW_STORAGE_KEY);
		if (stored === 'file' || stored === 'card') {
			explorer.entryViewMode = stored;
		}

		uploadQueue.onLibraryUploadSuccess(libraryId, refreshAfterUploadDebounced);
		uploadQueue.onLibraryUploadComplete(libraryId, refreshAfterUploadDebounced);

		let observer: IntersectionObserver | null = null;
		if (sentinel) {
			observer = new IntersectionObserver(
				(observerEntries) => {
					if (observerEntries[0]?.isIntersecting && explorer.nextCursor && !explorer.loadingMore) {
						void explorer.loadMore();
					}
				},
				{ rootMargin: '200px' }
			);
			observer.observe(sentinel);
		}

		return () => observer?.disconnect();
	});

	onDestroy(() => {
		uploadQueue.removeOnComplete(libraryId);
		uploadQueue.removeOnSuccess(libraryId);
		if (uploadRefreshTimer) {
			clearTimeout(uploadRefreshTimer);
			uploadRefreshTimer = null;
		}
	});

	// Persist the view mode whenever it changes.
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(ENTRY_VIEW_STORAGE_KEY, explorer.entryViewMode);
		}
	});

	// (Re)load entries whenever the library id, folder, or trash flag changes.
	$effect(() => {
		// Touch the reactive deps so this re-runs on navigation.
		void libraryId;
		void currentFolderId;
		void trashed;
		void explorer.fetchInitialData();
	});
</script>

<div
	class="relative flex h-full min-h-0 flex-1 flex-col gap-4"
	ondragenter={fileDrop.dropZoneProps.ondragenter}
	ondragover={fileDrop.dropZoneProps.ondragover}
	ondragleave={fileDrop.dropZoneProps.ondragleave}
	ondrop={fileDrop.dropZoneProps.ondrop}
	role="region"
	aria-label="Library files"
>
	{#if fileDrop.isOverDropZone}
		<div
			class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10"
		>
			<Badge class="gap-2 px-4 py-3 text-sm font-medium shadow-lg">
				<AppIcon name={ICONS.cloudUpload} class="size-4" />
				Drop files to upload to this folder
			</Badge>
		</div>
	{/if}

	<!-- Toolbar — portaled into the library header's breadcrumb row. Two
	     responsive variants share the same actions: a full desktop strip
	     (`sm:` and up) and a single-button mobile overflow (below `sm`) so a
	     handful of icon-only buttons don't crowd out the library title/
	     breadcrumb, which shares the row and needs to truncate gracefully. -->
	<div use:portal={'#library-header-actions'}>
		<div class="flex shrink-0 items-center gap-1.5">
			<!-- Desktop: every action as its own labeled button. -->
			<div class="hidden shrink-0 items-center gap-1.5 sm:flex">
				{#if !trashed}
					<Button
						variant={explorer.entryViewMode === 'file' ? 'secondary' : 'ghost'}
						size="icon-sm"
						aria-label="List view"
						aria-pressed={explorer.entryViewMode === 'file'}
						title="List view"
						onclick={() => (explorer.entryViewMode = 'file')}
					>
						<AppIcon name={ICONS.listView} class="size-4" />
					</Button>
					<Button
						variant={explorer.entryViewMode === 'card' ? 'secondary' : 'ghost'}
						size="icon-sm"
						aria-label="Grid view"
						aria-pressed={explorer.entryViewMode === 'card'}
						title="Grid view"
						onclick={() => (explorer.entryViewMode = 'card')}
					>
						<AppIcon name={ICONS.gridView} class="size-4" />
					</Button>
				{/if}

				{#if trashed && !explorer.filesPending && explorer.totalCount > 0}
					<Button variant="destructive" size="sm" onclick={() => openPurgeAllModal()}>
						<AppIcon name={ICONS.trash} class="size-4" />
						<span>Delete All</span>
					</Button>
				{/if}

				{#if canManageLibrary && !trashed}
					<div class="flex items-center gap-1.5">
						<Button variant="ghost" size="sm" onclick={() => folderActions.openCreateFolderModal()}>
							<AppIcon name={ICONS.folder} class="size-4" />
							<span>Folder</span>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => documentActions.openCreateDocumentModal()}
						>
							<AppIcon name={ICONS.file} class="size-4" />
							<span>Document</span>
						</Button>
						<Button variant="ghost" size="sm" onclick={() => (uploadOpen = true)}>
							<AppIcon name={ICONS.upload} class="size-4" />
							<span>Upload</span>
						</Button>
					</div>
				{/if}
			</div>

			<!-- Mobile: everything collapses into one overflow menu so the
			     breadcrumb/title keeps its space in the shared header row. -->
			{#if mobileToolbarHasItems}
				<div class="sm:hidden">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon-sm"
									aria-label="More actions"
									title="More actions"
								>
									<AppIcon name={ICONS.ellipsis} class="size-4" />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-48">
							{#if !trashed}
								<DropdownMenu.RadioGroup
									value={explorer.entryViewMode}
									onValueChange={(v) => (explorer.entryViewMode = v as 'file' | 'card')}
								>
									<DropdownMenu.RadioItem value="file">
										<AppIcon name={ICONS.listView} class="size-4" />
										List view
									</DropdownMenu.RadioItem>
									<DropdownMenu.RadioItem value="card">
										<AppIcon name={ICONS.gridView} class="size-4" />
										Grid view
									</DropdownMenu.RadioItem>
								</DropdownMenu.RadioGroup>
							{/if}

							{#if trashed && !explorer.filesPending && explorer.totalCount > 0}
								<DropdownMenu.Item variant="destructive" onSelect={() => openPurgeAllModal()}>
									<AppIcon name={ICONS.trash} class="size-4" />
									Delete All
								</DropdownMenu.Item>
							{/if}

							{#if canManageLibrary && !trashed}
								<DropdownMenu.Separator />
								<DropdownMenu.Item onSelect={() => folderActions.openCreateFolderModal()}>
									<AppIcon name={ICONS.folder} class="size-4" />
									New folder
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={() => documentActions.openCreateDocumentModal()}>
									<AppIcon name={ICONS.file} class="size-4" />
									New document
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={() => (uploadOpen = true)}>
									<AppIcon name={ICONS.upload} class="size-4" />
									Upload files
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			{/if}
		</div>
	</div>

	<ContextMenu.Root bind:open={contextMenuOpen}>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				<div
					{...props}
					class="relative min-h-0 flex-1 overflow-y-auto px-0.5"
					oncontextmenu={(event: MouseEvent) => {
						// Only let bits-ui open its menu when a row/card claimed THIS
						// event during the bubble phase (see showContextMenu, which
						// runs first — rows/cards are descendants of this div).
						// Otherwise leave the event alone entirely: no preventDefault,
						// no bits-ui open call, so the browser's native context menu
						// shows over empty space, grid gaps, the table header, and the
						// empty-state panel — instead of a stale or empty menu carried
						// over from a previously right-clicked entry.
						if (entryContextMenuHandled) {
							entryContextMenuHandled = false;
							(props.oncontextmenu as ((e: MouseEvent) => void) | undefined)?.(event);
						}
					}}
				>
					{#if explorer.filesPending && explorer.entries.length === 0}
						<!-- Skeleton placeholder while the first page loads (matches the table/grid
						     layout so there's no spinner-then-content layout jump). -->
						<LibraryEntriesSkeleton entryViewMode={explorer.entryViewMode} showTrashed={trashed} />
					{/if}

					{#if explorer.filesPending && explorer.entries.length > 0}
						<div
							class="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-background/35 pt-6"
						>
							<Badge variant="secondary" class="gap-2 px-3 py-3">
								<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
								Loading
							</Badge>
						</div>
					{/if}

					{#if explorer.entryViewMode === 'file' && explorer.entries.length > 0}
						<LibraryEntriesTable
							entries={explorer.entries}
							showTrashed={trashed}
							{dragEnabled}
							{draggedFileIds}
							{draggedFolderIds}
							{dropTargetFolderId}
							{renameValue}
							isEntrySelected={(e) => explorer.isEntrySelected(e)}
							{isRenaming}
							onrowClick={handleRowClick}
							onrowDoubleClick={openEntry}
							onrowContextMenu={showContextMenu}
							ondragStart={handleEntryDragStart}
							ondragEnd={handleEntryDragEnd}
							ondragEnter={handleFolderDragEnter}
							ondragOver={handleFolderDragOver}
							ondragLeave={handleFolderDragLeave}
							ondrop={handleFolderDrop}
							onsaveRename={saveEntryRename}
							oncancelRename={() => (renamingEntry = null)}
							onupdateRenameValue={(v) => (renameValue = v)}
						/>
					{:else if explorer.entryViewMode === 'card' && explorer.entries.length > 0}
						<LibraryEntriesGrid
							entries={explorer.entries}
							{libraryId}
							showTrashed={trashed}
							{dragEnabled}
							{draggedFileIds}
							{draggedFolderIds}
							{dropTargetFolderId}
							{renameValue}
							isEntrySelected={(e) => explorer.isEntrySelected(e)}
							{isRenaming}
							{failedThumbnails}
							{isImageFile}
							{isSmallImage}
							onrowClick={handleRowClick}
							onrowDoubleClick={openEntry}
							onrowContextMenu={showContextMenu}
							ondragStart={handleEntryDragStart}
							ondragEnd={handleEntryDragEnd}
							ondragEnter={handleFolderDragEnter}
							ondragOver={handleFolderDragOver}
							ondragLeave={handleFolderDragLeave}
							ondrop={handleFolderDrop}
							onsaveRename={saveEntryRename}
							oncancelRename={() => (renamingEntry = null)}
							onupdateRenameValue={(v) => (renameValue = v)}
							onthumbnailError={(id) => failedThumbnails.add(id)}
						/>
					{/if}

					{#if explorer.entries.length === 0 && !explorer.filesPending}
						<LibraryEmptyState
							showTrashed={trashed}
							title={emptyStateTitle}
							description={emptyStateDescription}
							{canManageLibrary}
							oncreateFolder={() => folderActions.openCreateFolderModal()}
							onuploadFiles={() => (uploadOpen = true)}
						/>
					{/if}

					<div bind:this={sentinel} class="h-px"></div>
					{#if explorer.loadingMore}
						<div class="flex items-center justify-center py-4">
							<AppIcon name={ICONS.loading} class="size-5 animate-spin text-muted-foreground" />
						</div>
					{/if}
				</div>
			{/snippet}
		</ContextMenu.Trigger>

		<!-- Right-click file/folder menu. A single Root+Trigger wraps the whole
		     entries area (rather than one per row) — the native contextmenu event
		     bubbles from whichever row was clicked up to this Trigger, which then
		     opens itself positioned at the cursor automatically; `showContextMenu`
		     above only computes which items apply. -->
		<ContextMenu.Content class="w-56">
			{#each contextMenuGroups as group, gi (gi)}
				{#if gi > 0}
					<ContextMenu.Separator />
				{/if}
				{#each group as item, ii (`${gi}-${ii}-${item.label}`)}
					{#if item.children}
						<ContextMenu.Sub>
							<ContextMenu.SubTrigger>
								<!-- The vendored SubTrigger primitive (unlike Item) doesn't
								     set `gap-2` itself — wrap the icon+label to match the
								     spacing of sibling Items. -->
								<span class="flex items-center gap-2">
									{#if item.icon}<AppIcon name={item.icon} class="size-4" />{/if}
									{item.label}
								</span>
							</ContextMenu.SubTrigger>
							<ContextMenu.SubContent class="w-48">
								{#each item.children as child (child.label)}
									<ContextMenu.Item disabled={child.disabled} onSelect={() => child.onSelect?.()}>
										{#if child.icon}<AppIcon name={child.icon} class="size-4" />{/if}
										{child.label}
									</ContextMenu.Item>
								{/each}
							</ContextMenu.SubContent>
						</ContextMenu.Sub>
					{:else}
						<ContextMenu.Item
							variant={item.color === 'error' ? 'destructive' : 'default'}
							disabled={item.disabled}
							onSelect={() => item.onSelect?.()}
						>
							{#if item.icon}<AppIcon name={item.icon} class="size-4" />{/if}
							{item.label}
						</ContextMenu.Item>
					{/if}
				{/each}
			{/each}
		</ContextMenu.Content>
	</ContextMenu.Root>

	<UploadModal
		bind:open={uploadOpen}
		{libraryId}
		libraryName={library?.name ?? 'Library'}
		parentFolderId={trashed ? null : currentFolderId}
	/>

	{#if previewFile}
		<FilePreview
			bind:open={previewOpen}
			file={previewFile}
			{libraryId}
			files={explorer.files}
			onnavigate={(f) => (previewFile = f)}
		/>
	{/if}

	<!-- Create Folder Modal -->
	<AppModal bind:open={folderActions.createFolderOpen} title="Create Folder">
		<div class="flex flex-col gap-2">
			<Label for="create-folder-name">Folder name</Label>
			<Input
				id="create-folder-name"
				placeholder="New folder"
				bind:value={folderActions.createFolderName}
				onkeydown={(e) => {
					if (e.key === 'Enter') folderActions.createFolder();
				}}
			/>
		</div>
		<div class="flex w-full justify-end gap-2">
			<Button
				type="button"
				variant="ghost"
				onclick={() => (folderActions.createFolderOpen = false)}
			>
				Cancel
			</Button>
			<Button
				disabled={!folderActions.createFolderName.trim() || folderActions.creatingFolder}
				onclick={() => folderActions.createFolder()}
			>
				{#if folderActions.creatingFolder}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.folder} class="size-4" />
				{/if}
				Create
			</Button>
		</div>
	</AppModal>

	<!-- Create Document Modal -->
	<AppModal bind:open={documentActions.createDocumentOpen} title="New Document">
		<div class="flex flex-col gap-2">
			<Label for="create-document-name">Document name</Label>
			<Input
				id="create-document-name"
				placeholder="Untitled"
				bind:value={documentActions.createDocumentName}
				onkeydown={(e) => {
					if (e.key === 'Enter') documentActions.createDocument();
				}}
			/>
			<p class="text-xs text-muted-foreground">
				A markdown file everyone in the library can edit together, live.
			</p>
		</div>
		<div class="flex w-full justify-end gap-2">
			<Button
				type="button"
				variant="ghost"
				onclick={() => (documentActions.createDocumentOpen = false)}
			>
				Cancel
			</Button>
			<Button
				disabled={!documentActions.createDocumentName.trim() || documentActions.creatingDocument}
				onclick={() => documentActions.createDocument()}
			>
				{#if documentActions.creatingDocument}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.file} class="size-4" />
				{/if}
				Create
			</Button>
		</div>
	</AppModal>

	<!-- Move Folder Modal -->
	<AppModal bind:open={folderActions.moveFolderOpen} title="Move Folder">
		<div class="flex flex-col gap-4">
			<p class="text-sm text-muted-foreground">
				Move <strong class="text-foreground">{folderActions.movingFolder?.name}</strong> to a new location.
			</p>
			<div class="flex flex-col gap-2">
				<Label for="move-folder-dest">Destination</Label>
				<Select.Root
					type="single"
					value={folderActions.moveDestinationValue}
					onValueChange={(v) => (folderActions.moveDestinationValue = v)}
					disabled={folderActions.moveLoading}
				>
					<Select.Trigger id="move-folder-dest" class="w-full">
						{moveFolderDestinationLabel}
					</Select.Trigger>
					<Select.Content>
						{#each folderActions.moveDestinationOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
		<div class="flex w-full justify-end gap-2">
			<Button type="button" variant="ghost" onclick={() => (folderActions.moveFolderOpen = false)}>
				Cancel
			</Button>
			<Button
				disabled={folderActions.moveLoading || folderActions.moveFolderSaving}
				onclick={() => folderActions.moveFolder()}
			>
				{#if folderActions.moveFolderSaving}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.folder} class="size-4" />
				{/if}
				Move
			</Button>
		</div>
	</AppModal>

	<!-- Move Files Modal -->
	<AppModal bind:open={moveFilesOpen} title="Move Files">
		<div class="flex flex-col gap-4">
			<p class="text-sm text-muted-foreground">
				Move <strong class="text-foreground">{moveFileCount}</strong>
				{moveFileCount === 1 ? 'file' : 'files'} to a new location.
			</p>
			<div class="flex flex-col gap-2">
				<Label for="move-files-dest">Destination</Label>
				<Select.Root
					type="single"
					value={moveFilesDestinationValue}
					onValueChange={(v) => (moveFilesDestinationValue = v)}
					disabled={moveFilesLoading}
				>
					<Select.Trigger id="move-files-dest" class="w-full">
						{moveFilesDestinationLabel}
					</Select.Trigger>
					<Select.Content>
						{#each moveFileDestinationOptions as option (option.value)}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
		<div class="flex w-full justify-end gap-2">
			<Button type="button" variant="ghost" onclick={closeMoveFilesModal}>Cancel</Button>
			<Button disabled={moveFilesLoading || moveFilesSaving} onclick={() => moveFiles()}>
				{#if moveFilesSaving}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.folder} class="size-4" />
				{/if}
				Move
			</Button>
		</div>
	</AppModal>

	<!-- Permanently Delete Items Modal -->
	<AppModal bind:open={purgeModalOpen} title="Permanently Delete Items">
		<div class="flex flex-col gap-4">
			<div
				class="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm"
			>
				<AppIcon name={ICONS.warning} class="mt-0.5 size-4 shrink-0 text-destructive" />
				<div>
					<p class="font-medium text-destructive">
						Delete {purgeFileCount}
						{purgeFileCount === 1 ? 'item' : 'items'}
					</p>
					<p class="text-muted-foreground">
						This will permanently delete these items from disk. This action cannot be undone.
					</p>
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="purge-confirm">Type 'delete' to confirm</Label>
				<Input id="purge-confirm" placeholder="delete" bind:value={purgeConfirmation} />
			</div>
		</div>
		<div class="flex w-full justify-end gap-2">
			<Button type="button" variant="ghost" onclick={() => (purgeModalOpen = false)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={purgeConfirmation !== 'delete'}
				onclick={() => handlePermanentDelete()}
			>
				<AppIcon name={ICONS.trash} class="size-4" />
				Delete Permanently
			</Button>
		</div>
	</AppModal>

	<!-- Large Download Warning Modal -->
	<AppModal bind:open={sizeWarningOpen} title="Large Download Warning">
		<div class="flex flex-col gap-3">
			<div
				class="flex items-start gap-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-sm text-warning"
			>
				<AppIcon name={ICONS.warning} class="mt-0.5 size-4 shrink-0" />
				<p>This download is very large and may take a while.</p>
			</div>
			<div class="grid grid-cols-2 gap-3 text-sm">
				<div class="rounded-md bg-muted/50 p-3">
					<p class="text-xs tracking-wide text-muted-foreground uppercase">Estimated Size</p>
					<p class="mt-1 font-medium">{zip.formattedEstimatedSize}</p>
				</div>
				<div class="rounded-md bg-muted/50 p-3">
					<p class="text-xs tracking-wide text-muted-foreground uppercase">Files</p>
					<p class="mt-1 font-medium">{zip.estimatedFileCount.toLocaleString('en-US')}</p>
				</div>
			</div>
		</div>
		<div class="flex w-full justify-end gap-2">
			<Button type="button" variant="ghost" onclick={() => zip.cancelLargeDownload()}>
				Cancel
			</Button>
			<Button disabled={zip.downloading} onclick={() => zip.confirmLargeDownload()}>
				{#if zip.downloading}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.download} class="size-4" />
				{/if}
				Download Anyway
			</Button>
		</div>
	</AppModal>
</div>
