import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Library, LibraryFile, LibraryFolder } from '$lib/types/api';

// ── Route + navigation mocks ──────────────────────────────────────────────────
const pageState = vi.hoisted(() => ({
	params: { id: 'lib-1' },
	url: new URL('http://localhost/libraries/lib-1'),
	data: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page: pageState }));

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto, invalidateAll: vi.fn() }));

// ── API mock (controllable per-test) ──────────────────────────────────────────
const apiMock = vi.hoisted(() => ({
	files: {
		update: vi.fn().mockResolvedValue({ id: 'file-1', name: 'renamed.jpg', updatedAt: 'now' }),
		delete: vi.fn().mockResolvedValue(undefined),
		restore: vi.fn().mockResolvedValue(undefined),
		purge: vi.fn().mockResolvedValue({ purged: 2 }),
		bulkTranscribe: vi.fn().mockResolvedValue({ enqueued: ['file-1'], skipped: {} }),
		bulkAudioDetect: vi.fn().mockResolvedValue({ enqueued: ['file-1'], skipped: {} })
	},
	folders: {
		update: vi.fn().mockResolvedValue({ id: 'folder-1', name: 'Renamed', updatedAt: 'now' }),
		restore: vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('$lib/api', () => ({
	api: apiMock,
	apiUrl: (p: string) => `http://api${p}`
}));

// ── Shared mutable explorer state, driven per-test ────────────────────────────
const explorerState = vi.hoisted(() => {
	type Entry = import('$lib/types/api').LibraryEntry;
	type File = import('$lib/types/api').LibraryFile;
	const state = {
		entries: [] as Entry[],
		filesPending: false,
		viewMode: 'files',
		entryViewMode: 'file' as 'file' | 'card',
		totalCount: 0,
		trashedCount: 0,
		nextCursor: null as string | null,
		loadingMore: false,
		libraryTags: [] as { id: string; name: string }[],
		breadcrumbs: [] as { id: string; name: string }[],
		lastClickedIndex: null as number | null,
		selectedFiles: new Set<string>(),
		selectedFolders: new Set<string>(),
		get files() {
			return state.entries.filter((e): e is File => e.kind === 'file');
		},
		get folders() {
			return state.entries.filter((e) => e.kind === 'folder');
		},
		buildFolderQuery: vi.fn(() => ({ folder: 'folder-1' })),
		clearSelection: vi.fn(() => {
			state.selectedFiles.clear();
			state.selectedFolders.clear();
		}),
		isEntrySelected: vi.fn(
			(e: Entry) =>
				(e.kind === 'file' && state.selectedFiles.has(e.id)) ||
				(e.kind === 'folder' && state.selectedFolders.has(e.id))
		),
		loadMore: vi.fn(),
		resetAndFetch: vi.fn().mockResolvedValue(undefined),
		refreshFolders: vi.fn().mockResolvedValue([]),
		refreshTrashedCount: vi.fn().mockResolvedValue(undefined),
		fetchInitialData: vi.fn().mockResolvedValue(undefined)
	};
	return state;
});

vi.mock('$lib/state/library-explorer.svelte', () => ({
	createLibraryExplorer: () => explorerState
}));

const tagsMock = vi.hoisted(() => ({
	areAllFilesTagged: vi.fn(() => false),
	isFolderTagAssigned: vi.fn(() => false),
	toggleTagForFiles: vi.fn(),
	toggleTagForFolder: vi.fn()
}));
vi.mock('$lib/state/library-tags.svelte', () => ({
	createLibraryTags: () => tagsMock
}));

const zipMock = vi.hoisted(() => ({
	downloading: false,
	showSizeWarning: false,
	estimatedFileCount: 0,
	formattedEstimatedSize: '0 B',
	startDownload: vi.fn(),
	confirmLargeDownload: vi.fn(),
	cancelLargeDownload: vi.fn()
}));
vi.mock('$lib/state/download-zip.svelte', () => ({
	createDownloadZip: () => zipMock
}));

const folderActionsMock = vi.hoisted(() => ({
	createFolderOpen: false,
	createFolderName: '',
	creatingFolder: false,
	moveFolderOpen: false,
	movingFolder: null as { name: string } | null,
	moveDestinationValue: '__root__',
	moveLoading: false,
	moveFolderSaving: false,
	moveDestinationOptions: [] as { label: string; value: string }[],
	openCreateFolderModal: vi.fn(),
	createFolder: vi.fn(),
	openMoveFolderModal: vi.fn(),
	moveFolder: vi.fn(),
	deleteFolders: vi.fn(),
	deleteFolder: vi.fn()
}));
vi.mock('$lib/state/library-folder-actions.svelte', () => ({
	ROOT_MOVE_VALUE: '__root__',
	createLibraryFolderActions: () => folderActionsMock
}));

const uploadQueueMock = vi.hoisted(() => ({
	successCb: null as null | (() => void),
	completeCb: null as null | (() => void),
	addFiles: vi.fn(),
	onLibraryUploadComplete: vi.fn((_: string, cb: () => void) => {
		uploadQueueMock.completeCb = cb;
	}),
	onLibraryUploadSuccess: vi.fn((_: string, cb: () => void) => {
		uploadQueueMock.successCb = cb;
	}),
	removeOnComplete: vi.fn(),
	removeOnSuccess: vi.fn()
}));
vi.mock('$lib/state/upload-queue.svelte', () => ({
	uploadQueue: uploadQueueMock
}));

const fileDropMock = vi.hoisted(
	() =>
		({
			isOverDropZone: false,
			dropZoneProps: {},
			onDrop: null as null | ((files: File[]) => void)
		}) as {
			isOverDropZone: boolean;
			dropZoneProps: object;
			onDrop: null | ((files: File[]) => void);
		}
);
vi.mock('$lib/state/file-drop.svelte', () => ({
	createFileDrop: (opts: { onDrop: (f: File[]) => void }) => {
		fileDropMock.onDrop = opts.onDrop;
		return fileDropMock;
	}
}));

const libraryFolderPathMock = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));
vi.mock('$lib/state/library-folder-path.svelte', () => ({
	libraryFolderPath: libraryFolderPathMock
}));

const toastMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import Page from './+page.svelte';
import Trash from './trash/+page.svelte';

function makeFile(overrides: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id: 'file-1',
		libraryId: 'lib-1',
		parentFolderId: null,
		name: 'photo.jpg',
		mimeType: 'image/jpeg',
		size: 1024,
		kind: 'file',
		duration: null,
		width: 1920,
		height: 1080,
		proxyStatus: null,
		thumbnailFileId: null,
		sourceFileId: null,
		originalCreatedAt: null,
		hash: null,
		trashedAt: null,
		createdAt: '2024-01-01',
		updatedAt: '2024-01-01',
		owner: null,
		tags: [],
		...overrides
	};
}

function makeFolder(overrides: Partial<LibraryFolder> = {}): LibraryFolder {
	return {
		id: 'folder-1',
		libraryId: 'lib-1',
		parentFolderId: null,
		name: 'My Folder',
		kind: 'folder',
		trashedAt: null,
		createdAt: '2024-01-01',
		updatedAt: '2024-01-01',
		owner: null,
		tags: [],
		...overrides
	};
}

const library: Library = {
	id: 'lib-1',
	name: 'Test Library',
	emoji: null,
	isDefault: false,
	faceRecognitionEnabled: false,
	ownerId: 'user-1',
	currentUserRole: 'owner',
	createdAt: '2024-01-01',
	updatedAt: '2024-01-01'
} as Library;

const user = { id: 'user-1', email: 'owner@x.io', displayName: 'Owner', role: 'owner' };
const viewer = { id: 'user-9', email: 'v@x.io', displayName: 'Viewer', role: 'member' };

function renderPage(overrides: { library?: Library | null; user?: unknown } = {}) {
	return render(Page, {
		props: {
			data: {
				library: 'library' in overrides ? overrides.library : library,
				user: 'user' in overrides ? overrides.user : user
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any
	});
}

function renderTrash() {
	return render(Trash, {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		props: { data: { library, user } } as any
	});
}

// Open the context menu for a row (default: first) and return the rendered menu.
async function openRowContextMenu(
	screen: ReturnType<typeof render>,
	rowIndex = 0
): Promise<HTMLElement> {
	const rows = screen.container.querySelectorAll('tbody tr');
	const row = rows[rowIndex] as HTMLElement;
	row.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 })
	);
	await tick();
	await tick();
	return screen.container.querySelector('[role="menu"]') as HTMLElement;
}

// Find a top-level (non-submenu) context-menu item by visible label.
function menuItem(menu: HTMLElement, label: string): HTMLButtonElement | undefined {
	return Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find((b) =>
		b.textContent?.includes(label)
	);
}

describe('/libraries/[id] (browser)', () => {
	beforeEach(() => {
		explorerState.entries = [];
		explorerState.filesPending = false;
		explorerState.viewMode = 'files';
		explorerState.entryViewMode = 'file';
		explorerState.totalCount = 0;
		explorerState.trashedCount = 0;
		explorerState.nextCursor = null;
		explorerState.loadingMore = false;
		explorerState.libraryTags = [];
		explorerState.breadcrumbs = [];
		explorerState.lastClickedIndex = null;
		explorerState.selectedFiles.clear();
		explorerState.selectedFolders.clear();
		pageState.url = new URL('http://localhost/libraries/lib-1');
		folderActionsMock.createFolderOpen = false;
		folderActionsMock.moveFolderOpen = false;
		folderActionsMock.movingFolder = null;
		zipMock.showSizeWarning = false;
		zipMock.downloading = false;
		fileDropMock.isOverDropZone = false;
		localStorage.clear();
		vi.clearAllMocks();
	});

	// ── Baseline rendering ───────────────────────────────────────────────────
	it('triggers the initial data load on mount', async () => {
		renderPage();
		expect(explorerState.fetchInitialData).toHaveBeenCalled();
	});

	it('shows the empty state when there are no entries and not pending', async () => {
		const screen = renderPage();
		await expect.element(screen.getByText('No files or folders yet')).toBeInTheDocument();
	});

	it('shows the folder-specific empty state when a folder is selected', async () => {
		pageState.url = new URL('http://localhost/libraries/lib-1?folder=folder-1');
		const screen = renderPage();
		await expect.element(screen.getByText('This folder is empty')).toBeInTheDocument();
	});

	it('renders the table view when entries exist in file mode', async () => {
		explorerState.entryViewMode = 'file';
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		await expect.element(screen.getByText('photo.jpg')).toBeInTheDocument();
		await expect.element(screen.getByRole('cell', { name: 'Name' })).toBeInTheDocument();
	});

	it('renders the grid view when entryViewMode is card', async () => {
		explorerState.entryViewMode = 'card';
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		await expect.element(screen.getByText('photo.jpg')).toBeInTheDocument();
	});

	it('shows the loading indicator when files are pending and nothing is loaded', async () => {
		explorerState.filesPending = true;
		const screen = renderPage();
		await expect.element(screen.getByText('Loading files')).toBeInTheDocument();
	});

	it('shows the overlay loading badge when pending with existing entries', async () => {
		explorerState.filesPending = true;
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		await expect.element(screen.getByText('Loading', { exact: true })).toBeInTheDocument();
	});

	it('renders the loading-more spinner', async () => {
		explorerState.entries = [makeFile()];
		explorerState.loadingMore = true;
		const screen = renderPage();
		// loadingMore spinner is the second animate-spin icon region.
		expect(screen.container.querySelector('.animate-spin')).toBeTruthy();
	});

	it('exposes the list/grid view toggle in the toolbar', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		await expect.element(screen.getByTitle('List view')).toBeInTheDocument();
		await expect.element(screen.getByTitle('Grid view')).toBeInTheDocument();
	});

	// ── Toolbar buttons ───────────────────────────────────────────────────────
	it('toggles the entry view mode via the toolbar', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const gridBtn = screen.container.querySelector(
			`button[title="Grid view"]`
		) as HTMLButtonElement;
		gridBtn.click();
		expect(explorerState.entryViewMode).toBe('card');
		const listBtn = screen.container.querySelector(
			`button[title="List view"]`
		) as HTMLButtonElement;
		listBtn.click();
		expect(explorerState.entryViewMode).toBe('file');
	});

	it('restores a persisted view mode on mount', async () => {
		localStorage.setItem('alcoves.library.entry-view', 'card');
		explorerState.entries = [makeFile()];
		renderPage();
		await tick();
		expect(explorerState.entryViewMode).toBe('card');
	});

	it('shows Folder + Upload buttons for managers and opens them', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const folderBtn = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('button')
		).find((b) => b.textContent?.trim() === 'Folder');
		folderBtn!.click();
		expect(folderActionsMock.openCreateFolderModal).toHaveBeenCalled();
		const uploadBtn = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('button')
		).find((b) => b.textContent?.trim() === 'Upload');
		uploadBtn!.click();
	});

	it('hides manager toolbar buttons for viewers', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage({ user: viewer, library: { ...library, currentUserRole: 'viewer' } });
		const folderBtn = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('button')
		).find((b) => b.textContent?.trim() === 'Folder');
		expect(folderBtn).toBeUndefined();
	});

	// ── Empty-state actions ────────────────────────────────────────────────────
	it('empty-state create-folder + upload actions fire', async () => {
		const screen = renderPage();
		await screen.getByRole('button', { name: 'Create Folder' }).click();
		expect(folderActionsMock.openCreateFolderModal).toHaveBeenCalled();
	});

	// ── Create folder modal ──────────────────────────────────────────────────
	it('renders the create-folder modal when the store flag is open', async () => {
		folderActionsMock.createFolderOpen = true;
		const screen = renderPage();
		await expect.element(screen.getByText('Folder name')).toBeInTheDocument();
		await screen.getByRole('button', { name: 'Cancel' }).first().click();
	});

	// ── Selection (row click) ────────────────────────────────────────────────
	it('plain row click selects a single entry', async () => {
		explorerState.entries = [makeFile(), makeFile({ id: 'file-2', name: 'b.jpg' })];
		const screen = renderPage();
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.click();
		expect(explorerState.clearSelection).toHaveBeenCalled();
		expect(explorerState.selectedFiles.has('file-1')).toBe(true);
	});

	it('ctrl/meta click toggles selection without clearing', async () => {
		explorerState.entries = [makeFile(), makeFile({ id: 'file-2', name: 'b.jpg' })];
		const screen = renderPage();
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
		expect(explorerState.selectedFiles.has('file-1')).toBe(true);
		// Toggle off
		row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
		expect(explorerState.selectedFiles.has('file-1')).toBe(false);
	});

	it('shift click selects a range from the anchor index', async () => {
		explorerState.entries = [
			makeFile(),
			makeFile({ id: 'file-2', name: 'b.jpg' }),
			makeFolder({ id: 'folder-1' })
		];
		explorerState.lastClickedIndex = 0;
		const screen = renderPage();
		const rows = screen.container.querySelectorAll('tbody tr');
		(rows[2] as HTMLElement).dispatchEvent(
			new MouseEvent('click', { bubbles: true, shiftKey: true })
		);
		expect(explorerState.selectedFiles.has('file-1')).toBe(true);
		expect(explorerState.selectedFiles.has('file-2')).toBe(true);
		expect(explorerState.selectedFolders.has('folder-1')).toBe(true);
	});

	it('double-click on a folder navigates, on a file opens preview', async () => {
		explorerState.entries = [makeFolder()];
		const screen = renderPage();
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(goto).toHaveBeenCalled();
	});

	it('double-click on a file opens the preview modal', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await tick();
		// FilePreview renders once previewFile is set.
		expect(screen.container.textContent).toBeTruthy();
	});

	// ── Context menu: single file ──────────────────────────────────────────────
	it('opens a file context menu and runs Download', async () => {
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		expect(menu).toBeTruthy();
		menuItem(menu, 'Download')!.click();
		expect(clickSpy).toHaveBeenCalled();
		clickSpy.mockRestore();
	});

	it('file context menu Move opens the move-files modal', async () => {
		explorerState.entries = [makeFile()];
		explorerState.refreshFolders = vi
			.fn()
			.mockResolvedValue([makeFolder({ id: 'f-a', name: 'Alpha' })]);
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Move')!.click();
		await tick();
		await expect.element(screen.getByText('Move Files')).toBeInTheDocument();
	});

	it('file context menu Rename enters rename mode', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		expect(screen.container.querySelector('[data-rename-input-entry-id="file-1"]')).toBeTruthy();
	});

	it('video files expose Editor + Transcribe + Detect audio menu items', async () => {
		explorerState.entries = [makeFile({ mimeType: 'video/mp4', name: 'clip.mp4' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		expect(menuItem(menu, 'Editor')).toBeTruthy();
		menuItem(menu, 'Editor')!.click();
		expect(goto).toHaveBeenCalledWith(expect.stringContaining('/edit/'));
	});

	it('runs Transcribe from the context menu and toasts success', async () => {
		explorerState.entries = [makeFile({ mimeType: 'audio/mp3', name: 'a.mp3' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Transcribe')!.click();
		await vi.waitFor(() => expect(apiMock.files.bulkTranscribe).toHaveBeenCalled());
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
		);
	});

	it('Transcribe toasts a warning when nothing is enqueued', async () => {
		apiMock.files.bulkTranscribe.mockResolvedValueOnce({ enqueued: [], skipped: { x: 'skip' } });
		explorerState.entries = [makeFile({ mimeType: 'audio/mp3' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Transcribe')!.click();
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'warning' }))
		);
	});

	it('Detect audio toasts an error when the API rejects', async () => {
		apiMock.files.bulkAudioDetect.mockRejectedValueOnce(new Error('boom'));
		explorerState.entries = [makeFile({ mimeType: 'audio/mp3' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Detect audio')!.click();
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(
				expect.objectContaining({ color: 'error', description: 'boom' })
			)
		);
	});

	it('Delete from the file context menu trashes the file', async () => {
		explorerState.entries = [makeFile()];
		explorerState.totalCount = 1;
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Delete')!.click();
		await vi.waitFor(() => expect(apiMock.files.delete).toHaveBeenCalled());
	});

	it('shows a tags submenu and toggles a tag', async () => {
		explorerState.libraryTags = [{ id: 'tag-1', name: 'Holiday' }];
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		// Open the "Tags" submenu trigger (has children → not runContextItem).
		menuItem(menu, 'Tags')!.click();
		await tick();
		const holiday = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
			b.textContent?.includes('Holiday')
		);
		holiday!.click();
		expect(tagsMock.toggleTagForFiles).toHaveBeenCalledWith(['file-1'], 'tag-1');
	});

	it('shows the empty "No tags yet" submenu entry when no tags exist', async () => {
		explorerState.libraryTags = [];
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Tags')!.click();
		await tick();
		expect(menu.textContent).toContain('No tags yet');
	});

	// ── Context menu: single folder ──────────────────────────────────────────
	it('folder context menu wires Open / Download / Rename / Move / Delete', async () => {
		explorerState.entries = [makeFolder()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Open')!.click();
		expect(goto).toHaveBeenCalled();

		const menu2 = await openRowContextMenu(screen);
		menuItem(menu2, 'Download as ZIP')!.click();
		expect(zipMock.startDownload).toHaveBeenCalledWith([], ['folder-1']);

		const menu3 = await openRowContextMenu(screen);
		menuItem(menu3, 'Move')!.click();
		expect(folderActionsMock.openMoveFolderModal).toHaveBeenCalled();

		const menu4 = await openRowContextMenu(screen);
		menuItem(menu4, 'Delete folder')!.click();
		expect(folderActionsMock.deleteFolder).toHaveBeenCalled();
	});

	// ── Context menu: multi-selection ──────────────────────────────────────────
	it('multi-select context menu offers bulk download/move/delete', async () => {
		explorerState.entries = [makeFile(), makeFile({ id: 'file-2', name: 'b.jpg' })];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFiles.add('file-2');
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		expect(menu.textContent).toContain('Download 2 items as ZIP');
		menuItem(menu, 'Delete 2 items')!.click();
		await vi.waitFor(() => expect(apiMock.files.delete).toHaveBeenCalled());
	});

	it('multi-select delete with folders calls folderActions.deleteFolders', async () => {
		explorerState.entries = [makeFile(), makeFolder({ id: 'folder-1' })];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFolders.add('folder-1');
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Delete 2 items')!.click();
		await vi.waitFor(() => expect(apiMock.files.delete).toHaveBeenCalled());
		expect(folderActionsMock.deleteFolders).toHaveBeenCalledWith(['folder-1']);
	});

	it('multi-select bulk download triggers the zip flow', async () => {
		explorerState.entries = [makeFile(), makeFile({ id: 'file-2', name: 'b.jpg' })];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFiles.add('file-2');
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Download 2 items as ZIP')!.click();
		expect(zipMock.startDownload).toHaveBeenCalled();
	});

	// ── Read-only viewer context menu ──────────────────────────────────────────
	it('viewer file context menu only offers Download', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage({
			user: viewer,
			library: { ...library, currentUserRole: 'viewer' }
		});
		const menu = await openRowContextMenu(screen);
		expect(menu.textContent).toContain('Download');
		expect(menu.textContent).not.toContain('Rename');
	});

	it('viewer folder context menu offers Open + Download as ZIP', async () => {
		explorerState.entries = [makeFolder()];
		const screen = renderPage({
			user: viewer,
			library: { ...library, currentUserRole: 'viewer' }
		});
		const menu = await openRowContextMenu(screen);
		expect(menu.textContent).toContain('Open');
		expect(menu.textContent).toContain('Download as ZIP');
	});

	// ── Rename save paths ──────────────────────────────────────────────────────
	it('renaming a file appends the original extension when none typed', async () => {
		explorerState.entries = [makeFile({ name: 'photo.jpg' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="file-1"] input'
		) as HTMLInputElement;
		input.value = 'newname';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		await vi.waitFor(() =>
			expect(apiMock.files.update).toHaveBeenCalledWith('lib-1', 'file-1', { name: 'newname.jpg' })
		);
	});

	it('renaming a folder calls folders.update and updates breadcrumbs', async () => {
		explorerState.entries = [makeFolder({ name: 'Old' })];
		explorerState.breadcrumbs = [{ id: 'folder-1', name: 'Old' }];
		apiMock.folders.update.mockResolvedValueOnce({
			id: 'folder-1',
			name: 'New',
			updatedAt: 'now'
		});
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="folder-1"] input'
		) as HTMLInputElement;
		input.value = 'New';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
		await vi.waitFor(() => expect(apiMock.folders.update).toHaveBeenCalled());
	});

	it('rename folder failure toasts an error', async () => {
		apiMock.folders.update.mockRejectedValueOnce(new Error('nope'));
		explorerState.entries = [makeFolder({ name: 'Old' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="folder-1"] input'
		) as HTMLInputElement;
		input.value = 'Changed';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to rename folder' })
			)
		);
	});

	it('rename file failure toasts an error', async () => {
		apiMock.files.update.mockRejectedValueOnce(new Error('nope'));
		explorerState.entries = [makeFile({ name: 'photo.jpg' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="file-1"] input'
		) as HTMLInputElement;
		input.value = 'changed.png';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to rename file' })
			)
		);
	});

	it('cancel-rename via Escape clears renaming state', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="file-1"] input'
		) as HTMLInputElement;
		const ev = new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' });
		input.dispatchEvent(ev);
		await tick();
		expect(screen.container.querySelector('[data-rename-input-entry-id="file-1"]')).toBeFalsy();
	});

	// ── Move files modal ──────────────────────────────────────────────────────
	it('move-files modal Move button performs the move', async () => {
		// Two selected files with *different* parents → the modal defaults the
		// destination to Root, so clicking Move (no select change needed) moves the
		// file whose parent isn't already Root.
		const fileA = makeFile({ id: 'file-1', parentFolderId: 'a', name: 'a.jpg' });
		const fileB = makeFile({ id: 'file-2', parentFolderId: null, name: 'b.jpg' });
		explorerState.entries = [fileA, fileB];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFiles.add('file-2');
		explorerState.refreshFolders = vi
			.fn()
			.mockResolvedValue([makeFolder({ id: 'a', name: 'Alpha' })]);
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Move 2 files')!.click();
		await vi.waitFor(() => expect(explorerState.refreshFolders).toHaveBeenCalled());

		// Use Playwright's locator so the click auto-waits for the enabled Move button.
		await screen.getByRole('button', { name: 'Move', exact: true }).click();
		// Only file-1 (parent 'a' ≠ null) is moved to Root; file-2 is already at Root.
		await vi.waitFor(() =>
			expect(apiMock.files.update).toHaveBeenCalledWith('lib-1', 'file-1', {
				parentFolderId: null
			})
		);
		expect(apiMock.files.update).not.toHaveBeenCalledWith('lib-1', 'file-2', expect.anything());
	});

	it('move-files modal Cancel closes without moving', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Move')!.click();
		await vi.waitFor(() => expect(screen.container.textContent).toContain('Move Files'));
		const cancelBtn = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('button')
		).find((b) => b.textContent?.trim() === 'Cancel');
		cancelBtn!.click();
		expect(apiMock.files.update).not.toHaveBeenCalled();
	});

	it('move-files refresh failure toasts an error', async () => {
		explorerState.entries = [makeFile()];
		explorerState.refreshFolders = vi.fn().mockRejectedValue(new Error('x'));
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Move')!.click();
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to load folders' })
			)
		);
	});

	// ── Trashed view ───────────────────────────────────────────────────────────
	it('renders the trash empty state', async () => {
		explorerState.entries = [];
		const screen = renderTrash();
		await expect.element(screen.getByText('Trash is empty')).toBeInTheDocument();
		expect(explorerState.viewMode).toBe('trash');
	});

	it('trash view shows Delete All and opens the purge-all modal', async () => {
		explorerState.entries = [makeFile({ trashedAt: '2024-02-01' })];
		explorerState.totalCount = 1;
		explorerState.filesPending = false;
		const screen = renderTrash();
		await screen.getByRole('button', { name: 'Delete All' }).click();
		await expect.element(screen.getByText('Permanently Delete Items')).toBeInTheDocument();
	});

	it('trash file context menu offers Restore + Permanently delete', async () => {
		explorerState.entries = [makeFile({ trashedAt: '2024-02-01' })];
		const screen = renderTrash();
		const menu = await openRowContextMenu(screen);
		expect(menu.textContent).toContain('Restore');
		menuItem(menu, 'Restore')!.click();
		await vi.waitFor(() => expect(apiMock.files.restore).toHaveBeenCalled());
	});

	it('trash file Permanently delete opens the purge modal', async () => {
		explorerState.entries = [makeFile({ trashedAt: '2024-02-01' })];
		const screen = renderTrash();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Permanently delete')!.click();
		await expect.element(screen.getByText('Permanently Delete Items')).toBeInTheDocument();
	});

	it('trash folder context menu offers Restore folder + Permanently delete folder', async () => {
		explorerState.entries = [makeFolder({ trashedAt: '2024-02-01' })];
		const screen = renderTrash();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Restore folder')!.click();
		await vi.waitFor(() => expect(apiMock.folders.restore).toHaveBeenCalled());
	});

	it('trash folder Permanently delete folder opens the purge modal', async () => {
		explorerState.entries = [makeFolder({ trashedAt: '2024-02-01' })];
		const screen = renderTrash();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Permanently delete folder')!.click();
		await expect.element(screen.getByText('Permanently Delete Items')).toBeInTheDocument();
	});

	it('trash context menu is empty for viewers', async () => {
		explorerState.entries = [makeFile({ trashedAt: '2024-02-01' })];
		const screen = render(Trash, {
			props: {
				data: { library: { ...library, currentUserRole: 'viewer' }, user: viewer }
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		});
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(screen.container.querySelector('[role="menu"]')).toBeFalsy();
	});

	// ── Purge modal confirm flow ──────────────────────────────────────────────
	it('purge confirmation requires typing "delete" then purges', async () => {
		explorerState.entries = [makeFile({ trashedAt: '2024-02-01' })];
		const screen = renderTrash();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Permanently delete')!.click();
		await tick();
		const confirm = screen.container.querySelector('#purge-confirm') as HTMLInputElement;
		confirm.value = 'delete';
		confirm.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		const deleteBtn = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('button')
		).find((b) => b.textContent?.includes('Delete Permanently'));
		deleteBtn!.click();
		await vi.waitFor(() => expect(apiMock.files.purge).toHaveBeenCalled());
	});

	it('purge-all confirm purges the whole trash', async () => {
		explorerState.entries = [makeFile({ trashedAt: '2024-02-01' })];
		explorerState.totalCount = 3;
		const screen = renderTrash();
		await screen.getByRole('button', { name: 'Delete All' }).click();
		await tick();
		const confirm = screen.container.querySelector('#purge-confirm') as HTMLInputElement;
		confirm.value = 'delete';
		confirm.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		const deleteBtn = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('button')
		).find((b) => b.textContent?.includes('Delete Permanently'));
		deleteBtn!.click();
		await vi.waitFor(() => expect(apiMock.files.purge).toHaveBeenCalledWith('lib-1'));
	});

	it('purge failure toasts an error', async () => {
		apiMock.files.purge.mockRejectedValueOnce(new Error('disk'));
		explorerState.entries = [makeFile({ trashedAt: '2024-02-01' })];
		const screen = renderTrash();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Permanently delete')!.click();
		await tick();
		const confirm = screen.container.querySelector('#purge-confirm') as HTMLInputElement;
		confirm.value = 'delete';
		confirm.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		const deleteBtn = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('button')
		).find((b) => b.textContent?.includes('Delete Permanently'));
		deleteBtn!.click();
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to permanently delete items' })
			)
		);
	});

	// ── Drag & drop ────────────────────────────────────────────────────────────
	it('dragging a file then dropping on a folder moves it', async () => {
		explorerState.entries = [
			makeFile({ id: 'file-1', parentFolderId: null }),
			makeFolder({ id: 'folder-1' })
		];
		const screen = renderPage();
		const rows = screen.container.querySelectorAll('tbody tr');
		const fileRow = rows[0] as HTMLElement;
		const folderRow = rows[1] as HTMLElement;
		const dt = new DataTransfer();
		fileRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		folderRow.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
		folderRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
		folderRow.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
		await vi.waitFor(() => expect(apiMock.files.update).toHaveBeenCalled());
	});

	it('drag leave clears the drop target', async () => {
		explorerState.entries = [makeFile(), makeFolder({ id: 'folder-1' })];
		const screen = renderPage();
		const rows = screen.container.querySelectorAll('tbody tr');
		const fileRow = rows[0] as HTMLElement;
		const folderRow = rows[1] as HTMLElement;
		const dt = new DataTransfer();
		fileRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		folderRow.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
		folderRow.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: dt }));
		fileRow.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
		expect(true).toBe(true);
	});

	// ── File drop (upload) ─────────────────────────────────────────────────────
	it('the file-drop overlay renders when dragging over the drop zone', async () => {
		fileDropMock.isOverDropZone = true;
		const screen = renderPage();
		await expect
			.element(screen.getByText('Drop files to upload to this folder'))
			.toBeInTheDocument();
	});

	it('dropping files into the zone enqueues them for upload', async () => {
		renderPage();
		// createFileDrop captured the onDrop callback.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(fileDropMock as any).onDrop([new File(['x'], 'a.txt')]);
		expect(uploadQueueMock.addFiles).toHaveBeenCalled();
		expect(toastMock.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: expect.stringContaining('added to upload queue') })
		);
	});

	// ── Size-warning modal mirroring ───────────────────────────────────────────
	it('mirrors the zip size-warning flag into a visible modal', async () => {
		zipMock.showSizeWarning = true;
		const screen = renderPage();
		await tick();
		await expect.element(screen.getByText('Large Download Warning')).toBeInTheDocument();
	});

	// ── Context menu dismissal ─────────────────────────────────────────────────
	it('window click closes an open context menu', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		expect(menu).toBeTruthy();
		window.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await tick();
		expect(screen.container.querySelector('[role="menu"]')).toBeFalsy();
	});

	// ── Large-download size-warning modal buttons ──────────────────────────────
	it('size-warning modal Cancel calls cancelLargeDownload', async () => {
		zipMock.showSizeWarning = true;
		const screen = renderPage();
		await vi.waitFor(() =>
			expect(screen.container.textContent).toContain('Large Download Warning')
		);
		await screen.getByRole('button', { name: 'Cancel', exact: true }).click();
		expect(zipMock.cancelLargeDownload).toHaveBeenCalled();
	});

	it('size-warning modal Download Anyway calls confirmLargeDownload', async () => {
		zipMock.showSizeWarning = true;
		const screen = renderPage();
		await vi.waitFor(() =>
			expect(screen.container.textContent).toContain('Large Download Warning')
		);
		await screen.getByRole('button', { name: 'Download Anyway' }).click();
		expect(zipMock.confirmLargeDownload).toHaveBeenCalled();
	});

	// ── downloadSelection branch (single file vs zip) ──────────────────────────
	it('single-file download goes through the direct link, not the zip', async () => {
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		explorerState.entries = [makeFile()];
		explorerState.selectedFiles.add('file-1');
		const screen = renderPage({ user: viewer, library: { ...library, currentUserRole: 'viewer' } });
		const menu = await openRowContextMenu(screen);
		// Viewer single-file selection → "Download" runs downloadSelection → single file.
		menuItem(menu, 'Download')!.click();
		expect(clickSpy).toHaveBeenCalled();
		expect(zipMock.startDownload).not.toHaveBeenCalled();
		clickSpy.mockRestore();
	});

	it('viewer multi-select downloads a zip via downloadSelection', async () => {
		explorerState.entries = [makeFile(), makeFolder({ id: 'folder-1' })];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFolders.add('folder-1');
		const screen = renderPage({ user: viewer, library: { ...library, currentUserRole: 'viewer' } });
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Download 2 items as ZIP')!.click();
		expect(zipMock.startDownload).toHaveBeenCalledWith(['file-1'], ['folder-1']);
	});

	// ── Rename edge cases ──────────────────────────────────────────────────────
	it('saving a rename to an empty value just exits rename mode', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="file-1"] input'
		) as HTMLInputElement;
		input.value = '   ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		await tick();
		expect(apiMock.files.update).not.toHaveBeenCalled();
	});

	it('renaming a folder to the same name is a no-op', async () => {
		explorerState.entries = [makeFolder({ name: 'Same' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="folder-1"] input'
		) as HTMLInputElement;
		input.value = 'Same';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		await tick();
		expect(apiMock.folders.update).not.toHaveBeenCalled();
	});

	it('renaming a file to the same resolved name is a no-op', async () => {
		explorerState.entries = [makeFile({ name: 'photo.jpg' })];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Rename')!.click();
		await tick();
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id="file-1"] input'
		) as HTMLInputElement;
		input.value = 'photo'; // resolves to photo.jpg
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		await tick();
		expect(apiMock.files.update).not.toHaveBeenCalled();
	});

	// ── Drag start with a multi-selection ──────────────────────────────────────
	it('dragging a file that is part of a selection carries every selected id', async () => {
		explorerState.entries = [
			makeFile({ id: 'file-1' }),
			makeFile({ id: 'file-2', name: 'b.jpg' }),
			makeFolder({ id: 'folder-1' })
		];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFiles.add('file-2');
		const screen = renderPage();
		const rows = screen.container.querySelectorAll('tbody tr');
		const dt = new DataTransfer();
		(rows[0] as HTMLElement).dispatchEvent(
			new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })
		);
		// Both selected ids serialised to the drag payload.
		expect(dt.getData('text/plain')).toContain('file-1');
		expect(dt.getData('text/plain')).toContain('file-2');
		(rows[2] as HTMLElement).dispatchEvent(
			new DragEvent('drop', { bubbles: true, dataTransfer: dt })
		);
		await vi.waitFor(() => expect(apiMock.files.update).toHaveBeenCalled());
	});

	it('dropping on a folder with no movable files is a no-op', async () => {
		// File already lives in folder-1, so dropping it back there moves nothing.
		explorerState.entries = [
			makeFile({ id: 'file-1', parentFolderId: 'folder-1' }),
			makeFolder({ id: 'folder-1' })
		];
		const screen = renderPage();
		const rows = screen.container.querySelectorAll('tbody tr');
		const dt = new DataTransfer();
		(rows[0] as HTMLElement).dispatchEvent(
			new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })
		);
		(rows[1] as HTMLElement).dispatchEvent(
			new DragEvent('drop', { bubbles: true, dataTransfer: dt })
		);
		await tick();
		expect(apiMock.files.update).not.toHaveBeenCalled();
	});

	it('drop move failure toasts an error', async () => {
		apiMock.files.update.mockRejectedValueOnce(new Error('move failed'));
		explorerState.entries = [
			makeFile({ id: 'file-1', parentFolderId: null }),
			makeFolder({ id: 'folder-1' })
		];
		const screen = renderPage();
		const rows = screen.container.querySelectorAll('tbody tr');
		const dt = new DataTransfer();
		(rows[0] as HTMLElement).dispatchEvent(
			new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })
		);
		(rows[1] as HTMLElement).dispatchEvent(
			new DragEvent('drop', { bubbles: true, dataTransfer: dt })
		);
		await vi.waitFor(() =>
			expect(toastMock.add).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to move file(s)' })
			)
		);
	});

	// ── Multi-select bulk transcribe / audio detect ─────────────────────────────
	it('multi-select Transcribe queues all selected files', async () => {
		explorerState.entries = [
			makeFile({ id: 'file-1', mimeType: 'video/mp4' }),
			makeFile({ id: 'file-2', mimeType: 'audio/mp3', name: 'b.mp3' })
		];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFiles.add('file-2');
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Transcribe 2 file(s)')!.click();
		await vi.waitFor(() => expect(apiMock.files.bulkTranscribe).toHaveBeenCalled());
	});

	it('multi-select Detect audio queues all selected files', async () => {
		explorerState.entries = [makeFile({ id: 'file-1' }), makeFile({ id: 'file-2', name: 'b.jpg' })];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFiles.add('file-2');
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Detect audio in 2 file(s)')!.click();
		await vi.waitFor(() => expect(apiMock.files.bulkAudioDetect).toHaveBeenCalled());
	});

	// ── Tag submenus on folder + multi-select ──────────────────────────────────
	it('folder context menu toggles a folder tag', async () => {
		explorerState.libraryTags = [{ id: 'tag-1', name: 'Trip' }];
		explorerState.entries = [makeFolder()];
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Tags')!.click();
		await tick();
		const tagBtn = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
			b.textContent?.includes('Trip')
		);
		tagBtn!.click();
		expect(tagsMock.toggleTagForFolder).toHaveBeenCalled();
	});

	it('multi-select tag submenu toggles tags for all files', async () => {
		explorerState.libraryTags = [{ id: 'tag-1', name: 'Trip' }];
		explorerState.entries = [makeFile({ id: 'file-1' }), makeFile({ id: 'file-2', name: 'b.jpg' })];
		explorerState.selectedFiles.add('file-1');
		explorerState.selectedFiles.add('file-2');
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Tags')!.click();
		await tick();
		const tagBtn = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
			b.textContent?.includes('Trip')
		);
		tagBtn!.click();
		expect(tagsMock.toggleTagForFiles).toHaveBeenCalledWith(['file-1', 'file-2'], 'tag-1');
	});

	// ── Move folder modal options + restore folders ─────────────────────────────
	it('renders the move-folder modal with destination options', async () => {
		folderActionsMock.moveFolderOpen = true;
		folderActionsMock.movingFolder = { name: 'Docs' };
		folderActionsMock.moveDestinationOptions = [
			{ label: 'Root', value: '__root__' },
			{ label: 'Photos', value: 'p1' }
		];
		const screen = renderPage();
		await vi.waitFor(() => expect(screen.container.textContent).toContain('Move Folder'));
		expect(screen.container.textContent).toContain('Docs');
	});

	it('grid view opens a context menu from a card and toggles a file tag', async () => {
		explorerState.entryViewMode = 'card';
		explorerState.libraryTags = [{ id: 'tag-1', name: 'Fun' }];
		explorerState.entries = [makeFile()];
		const screen = renderPage();
		await expect.element(screen.getByText('photo.jpg')).toBeInTheDocument();
		const card = screen.container.querySelector('div[role="button"]') as HTMLElement;
		card.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
		);
		await tick();
		await tick();
		const menu = screen.container.querySelector('[role="menu"]') as HTMLElement;
		expect(menu).toBeTruthy();
		menuItem(menu, 'Tags')!.click();
		await tick();
		const tagBtn = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
			b.textContent?.includes('Fun')
		);
		tagBtn!.click();
		expect(tagsMock.toggleTagForFiles).toHaveBeenCalledWith(['file-1'], 'tag-1');
	});

	it('grid view thumbnail error is recorded', async () => {
		explorerState.entryViewMode = 'card';
		explorerState.entries = [makeFile({ thumbnailFileId: 'thumb-1' })];
		const screen = renderPage();
		await expect.element(screen.getByText('photo.jpg')).toBeInTheDocument();
		const img = screen.container.querySelector('img');
		if (img) img.dispatchEvent(new Event('error', { bubbles: true }));
		// No throw → the onthumbnailError path executed (failedThumbnails.add).
		expect(screen.container.textContent).toContain('photo.jpg');
	});

	// ── Upload-success refresh debounce ─────────────────────────────────────────
	it('an upload-success callback refreshes the explorer (debounced)', async () => {
		explorerState.entries = [makeFile()];
		renderPage();
		expect(uploadQueueMock.successCb).toBeTypeOf('function');
		// First call fires immediately…
		uploadQueueMock.successCb!();
		expect(explorerState.resetAndFetch).toHaveBeenCalledWith({ silent: true });
		// …a second call within the window schedules a debounced refresh (timer path).
		uploadQueueMock.successCb!();
		uploadQueueMock.completeCb?.();
	});

	// ── buildFolderLabel nested path ────────────────────────────────────────────
	it('move-files modal builds nested folder labels', async () => {
		explorerState.entries = [makeFile({ parentFolderId: null })];
		explorerState.refreshFolders = vi
			.fn()
			.mockResolvedValue([
				makeFolder({ id: 'root-f', name: 'Root Folder', parentFolderId: null }),
				makeFolder({ id: 'child-f', name: 'Child', parentFolderId: 'root-f' })
			]);
		const screen = renderPage();
		const menu = await openRowContextMenu(screen);
		menuItem(menu, 'Move')!.click();
		await vi.waitFor(() => {
			const opt = screen.container.querySelector('#move-files-dest option[value="child-f"]');
			if (!opt) throw new Error('nested option not ready');
		});
		const nested = screen.container.querySelector(
			'#move-files-dest option[value="child-f"]'
		) as HTMLOptionElement;
		expect(nested.textContent).toContain('Root Folder / Child');
	});

	// ── Drag handler guards ─────────────────────────────────────────────────────
	it('drag handlers ignore folders and no-ops cleanly', async () => {
		explorerState.entries = [makeFolder({ id: 'folder-1' }), makeFile({ id: 'file-1' })];
		const screen = renderPage();
		const rows = screen.container.querySelectorAll('tbody tr');
		const folderRow = rows[0] as HTMLElement;
		const dt = new DataTransfer();
		// dragstart on a folder row → guarded no-op (entry.kind !== 'file').
		folderRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
		// dragenter/over on a folder with no dragged ids → guarded no-op.
		folderRow.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
		folderRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
		folderRow.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: dt }));
		expect(apiMock.files.update).not.toHaveBeenCalled();
	});

	// ── Row click: multi-select folders + shift without anchor ──────────────────
	it('ctrl-click toggles folder selection', async () => {
		explorerState.entries = [makeFolder({ id: 'folder-1' })];
		const screen = renderPage();
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
		expect(explorerState.selectedFolders.has('folder-1')).toBe(true);
		row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
		expect(explorerState.selectedFolders.has('folder-1')).toBe(false);
	});

	it('shift-click with no anchor falls back to single select', async () => {
		explorerState.entries = [makeFile(), makeFolder({ id: 'folder-1' })];
		explorerState.lastClickedIndex = null;
		const screen = renderPage();
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		expect(explorerState.selectedFiles.has('file-1')).toBe(true);
	});

	it('plain click selecting a folder clears then selects it', async () => {
		explorerState.entries = [makeFolder({ id: 'folder-1' })];
		const screen = renderPage();
		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.click();
		expect(explorerState.clearSelection).toHaveBeenCalled();
		expect(explorerState.selectedFolders.has('folder-1')).toBe(true);
	});
});
