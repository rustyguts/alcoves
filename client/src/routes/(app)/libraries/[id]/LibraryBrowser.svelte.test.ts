import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Library, LibraryFolder } from '$lib/types/api';

/**
 * Focused regression coverage for two LibraryBrowser fixes that need a REAL
 * (unmocked) `createLibraryFolderActions` store to prove anything:
 *
 * 1. F1/F4/F9 — the single ContextMenu.Root+Trigger wrapping the whole
 *    entries area must never open a stale/empty menu when a right-click
 *    lands on empty space rather than a row, and must never leave a
 *    previous entry's items behind after the menu closes.
 * 2. The create-folder / move-folder modals' `bind:open={folderActions.*}`
 *    two-way sync — open AND every close path (X, Escape, backdrop, the
 *    modal's own Cancel action) must round-trip back to the store's real
 *    `$state`, not just hide the dialog locally.
 *
 * `page.svelte.test.ts` mocks `library-folder-actions.svelte` with a plain
 * (non-reactive) object literal, which is fine for exercising LibraryBrowser's
 * OWN logic but can't prove anything about the store's real getter/setter
 * accessors (backed by `$state`). Here we let the real factory run and only
 * capture a handle to its return value for assertions.
 */

// ── Route + navigation mocks ──────────────────────────────────────────────────
const pageState = vi.hoisted(() => ({
	params: { id: 'lib-1' },
	url: new URL('http://localhost/libraries/lib-1'),
	data: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

// ── API mock ────────────────────────────────────────────────────────────────
const apiMock = vi.hoisted(() => ({
	files: {
		delete: vi.fn().mockResolvedValue(undefined)
	},
	folders: {
		create: vi.fn().mockResolvedValue({ id: 'new-folder', name: 'New', parentFolderId: null }),
		move: vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('$lib/api', () => ({
	api: apiMock,
	apiUrl: (p: string) => `http://api${p}`
}));

// ── Explorer store (mocked — its own behavior isn't under test here) ─────────
const explorerState = vi.hoisted(() => {
	type Entry = import('$lib/types/api').LibraryEntry;
	type File = import('$lib/types/api').LibraryFile;
	const state = {
		entries: [] as Entry[],
		filesPending: false,
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
		buildFolderQuery: vi.fn(() => ({})),
		clearSelection: vi.fn(),
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

vi.mock('$lib/state/library-tags.svelte', () => ({
	createLibraryTags: () => ({
		areAllFilesTagged: () => false,
		isFolderTagAssigned: () => false,
		toggleTagForFiles: vi.fn(),
		toggleTagForFolder: vi.fn()
	})
}));

vi.mock('$lib/state/download-zip.svelte', () => ({
	createDownloadZip: () => ({
		downloading: false,
		showSizeWarning: false,
		estimatedFileCount: 0,
		formattedEstimatedSize: '0 B',
		startDownload: vi.fn(),
		confirmLargeDownload: vi.fn(),
		cancelLargeDownload: vi.fn()
	})
}));

vi.mock('$lib/state/upload-queue.svelte', () => ({
	uploadQueue: {
		addFiles: vi.fn(),
		onLibraryUploadComplete: vi.fn(),
		onLibraryUploadSuccess: vi.fn(),
		removeOnComplete: vi.fn(),
		removeOnSuccess: vi.fn()
	}
}));

vi.mock('$lib/state/file-drop.svelte', () => ({
	createFileDrop: () => ({ isOverDropZone: false, dropZoneProps: {} })
}));

vi.mock('$lib/state/library-folder-path.svelte', () => ({
	libraryFolderPath: { set: vi.fn(), clear: vi.fn() }
}));

vi.mock('$lib/state/toast', () => ({ toast: { add: vi.fn() } }));

// ── `library-folder-actions.svelte` — intentionally NOT mocked. We wrap the
// real factory so the store's real `$state`-backed getters/setters run
// exactly as they do in production, while capturing a handle for assertions.
type FolderActions = ReturnType<
	typeof import('$lib/state/library-folder-actions.svelte').createLibraryFolderActions
>;
const capturedFolderActions = vi.hoisted(() => ({ current: null as FolderActions | null }));
vi.mock('$lib/state/library-folder-actions.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/state/library-folder-actions.svelte')>();
	return {
		createLibraryFolderActions: (...args: Parameters<typeof actual.createLibraryFolderActions>) => {
			const instance = actual.createLibraryFolderActions(...args);
			capturedFolderActions.current = instance;
			return instance;
		}
	};
});

import LibraryBrowser from './LibraryBrowser.svelte';

function makeFile(overrides: Partial<import('$lib/types/api').LibraryFile> = {}) {
	return {
		id: 'file-1',
		libraryId: 'lib-1',
		parentFolderId: null,
		name: 'photo.jpg',
		mimeType: 'image/jpeg',
		size: 1024,
		kind: 'file' as const,
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
const user = {
	id: 'user-1',
	email: 'owner@x.io',
	displayName: 'Owner',
	role: 'owner',
	avatarUrl: null
};

function renderBrowser() {
	return render(LibraryBrowser, { props: { library, user, trashed: false } });
}

function menu(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[role="menu"]');
}

function menuItem(root: HTMLElement, label: string): HTMLElement | undefined {
	return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) =>
		el.textContent?.includes(label)
	);
}

function folderButton(): HTMLButtonElement {
	const btn = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
		(b) => b.textContent?.trim() === 'Folder'
	);
	expect(btn, 'Folder toolbar button').toBeTruthy();
	return btn!;
}

function dialogContent(): HTMLElement {
	const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
	expect(content, 'dialog content').toBeTruthy();
	return content!;
}

describe('LibraryBrowser — context menu staleness (F1/F4/F9)', () => {
	beforeEach(() => {
		explorerState.entries = [];
		explorerState.selectedFiles.clear();
		explorerState.selectedFolders.clear();
		explorerState.lastClickedIndex = null;
		explorerState.totalCount = 0;
		pageState.url = new URL('http://localhost/libraries/lib-1');
		vi.clearAllMocks();
	});

	it('right-click on empty space opens no menu and does not suppress the native context menu', async () => {
		explorerState.entries = [makeFile()];
		const screen = renderBrowser();
		await tick();

		// The scrollable entries container itself (the ContextMenu.Trigger's
		// child div) — right-clicking it directly (not a row) simulates empty
		// space / a gap / the area below a short list.
		const container = screen.container.querySelector('.overflow-y-auto') as HTMLElement;
		expect(container).toBeTruthy();
		const event = new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: 5,
			clientY: 5
		});
		container.dispatchEvent(event);
		await tick();
		await tick();

		expect(menu()).toBeFalsy();
		// Un-prevented → the browser's native context menu would show.
		expect(event.defaultPrevented).toBe(false);
	});

	it('opening a menu for one entry, closing it, then right-clicking empty space never resurrects its items', async () => {
		explorerState.entries = [makeFile({ id: 'file-1', name: 'a.jpg' })];
		explorerState.totalCount = 1;
		const screen = renderBrowser();
		await tick();

		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 })
		);
		await tick();
		await tick();
		const openMenu = menu();
		expect(openMenu).toBeTruthy();
		expect(menuItem(openMenu!, 'Delete')).toBeTruthy();

		// Dismiss via Escape.
		openMenu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await vi.waitFor(() => expect(menu()).toBeFalsy());

		// Right-click empty space (the container, not a row) — must NOT
		// resurrect file-1's menu.
		const container = screen.container.querySelector('.overflow-y-auto') as HTMLElement;
		const event = new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: 5,
			clientY: 5
		});
		container.dispatchEvent(event);
		await tick();
		await tick();

		expect(menu()).toBeFalsy();
		expect(event.defaultPrevented).toBe(false);
	});

	it('a fresh right-click on a different row after closing shows only that row’s items', async () => {
		explorerState.entries = [
			makeFile({ id: 'file-1', name: 'a.jpg' }),
			makeFolder({ id: 'folder-1', name: 'Docs' })
		];
		const screen = renderBrowser();
		await tick();

		const rows = screen.container.querySelectorAll('tbody tr');
		(rows[0] as HTMLElement).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
		);
		await tick();
		await tick();
		expect(menuItem(menu()!, 'Rename')).toBeTruthy();
		menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await vi.waitFor(() => expect(menu()).toBeFalsy());

		(rows[1] as HTMLElement).dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
		);
		await tick();
		await tick();
		const folderMenu = menu();
		expect(folderMenu).toBeTruthy();
		expect(menuItem(folderMenu!, 'Delete folder')).toBeTruthy();
	});
});

describe('LibraryBrowser — create-folder/move-folder bind:open sync', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		explorerState.entries = [];
		explorerState.selectedFiles.clear();
		explorerState.selectedFolders.clear();
		pageState.url = new URL('http://localhost/libraries/lib-1');
		capturedFolderActions.current = null;
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it('open via the toolbar and close via the dialog X button round-trip the real store', async () => {
		renderBrowser();
		await tick();
		expect(capturedFolderActions.current).toBeTruthy();

		folderButton().click();
		await tick();
		expect(capturedFolderActions.current!.createFolderOpen).toBe(true);
		const content = dialogContent();
		expect(content.textContent).toContain('Folder name');

		const closeBtn = document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
		expect(closeBtn).toBeTruthy();
		closeBtn!.click();

		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});
		// Proves the write-back reached the real `$state`, not just AppModal's
		// own local bindable.
		expect(capturedFolderActions.current!.createFolderOpen).toBe(false);
	});

	it('closes via Escape and syncs the store back to false', async () => {
		renderBrowser();
		await tick();
		folderButton().click();
		await tick();
		expect(capturedFolderActions.current!.createFolderOpen).toBe(true);

		document
			.querySelector('[data-slot="dialog-content"]')!
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});
		expect(capturedFolderActions.current!.createFolderOpen).toBe(false);
	});

	it('closes via clicking the backdrop overlay and syncs the store back to false', async () => {
		renderBrowser();
		await tick();
		folderButton().click();
		await tick();
		expect(capturedFolderActions.current!.createFolderOpen).toBe(true);

		const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
		expect(overlay).toBeTruthy();
		// bits-ui's DismissibleLayer registers its outside-pointerdown listeners
		// ~1ms after open (afterSleep(1, ...)) and debounces the handler by a
		// further 10ms — give it real wall-clock time before dispatching.
		await new Promise((resolve) => setTimeout(resolve, 30));
		overlay!.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
		);

		await vi.waitFor(
			() => {
				expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
			},
			{ timeout: 2000 }
		);
		expect(capturedFolderActions.current!.createFolderOpen).toBe(false);
	});

	it('closes via the modal’s own Cancel action and syncs the store back to false', async () => {
		renderBrowser();
		await tick();
		folderButton().click();
		await tick();
		const content = dialogContent();
		const cancelBtn = Array.from(content.querySelectorAll<HTMLButtonElement>('button')).find(
			(b) => b.textContent?.trim() === 'Cancel'
		);
		expect(cancelBtn).toBeTruthy();
		cancelBtn!.click();

		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});
		expect(capturedFolderActions.current!.createFolderOpen).toBe(false);
	});

	it('move-folder modal (opened from the context menu) round-trips open + X-close', async () => {
		explorerState.entries = [makeFolder({ id: 'folder-1', name: 'Docs' })];
		const screen = renderBrowser();
		await tick();

		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();
		await tick();
		menuItem(menu()!, 'Move')!.click();
		await tick();

		expect(capturedFolderActions.current!.moveFolderOpen).toBe(true);
		await vi.waitFor(() => {
			expect(document.body.textContent).toContain('Move Folder');
		});

		const closeBtn = document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
		closeBtn!.click();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});
		expect(capturedFolderActions.current!.moveFolderOpen).toBe(false);
	});

	it('never emits a binding_property_non_reactive warning for the folder-actions dialogs', async () => {
		explorerState.entries = [makeFolder({ id: 'folder-1', name: 'Docs' })];
		const screen = renderBrowser();
		await tick();

		folderButton().click();
		await tick();
		document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});

		const row = screen.container.querySelector('tbody tr') as HTMLElement;
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();
		await tick();
		menuItem(menu()!, 'Move')!.click();
		await tick();
		await vi.waitFor(() => expect(document.body.textContent).toContain('Move Folder'));
		document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click();
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});

		const warnedNonReactive = warnSpy.mock.calls.some((call: unknown[]) =>
			call.some(
				(arg: unknown) => typeof arg === 'string' && arg.includes('binding_property_non_reactive')
			)
		);
		expect(warnedNonReactive).toBe(false);
	});
});
