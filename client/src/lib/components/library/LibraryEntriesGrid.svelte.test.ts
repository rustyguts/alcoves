import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LibraryEntriesGrid from './LibraryEntriesGrid.svelte';
import type { LibraryEntry, LibraryFile, LibraryFolder } from '$lib/types/api';

function makeFolder(over: Partial<LibraryFolder> = {}): LibraryFolder {
	return {
		id: 'folder-1',
		kind: 'folder',
		name: 'My Folder',
		tags: [],
		...over
	} as LibraryFolder;
}

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id: 'file-1',
		kind: 'file',
		name: 'photo.jpg',
		mimeType: 'image/jpeg',
		thumbnailFileId: null,
		proxyStatus: null,
		width: 1920,
		height: 1080,
		duration: null,
		tags: [],
		...over
	} as LibraryFile;
}

function defaultProps(over: Record<string, unknown> = {}) {
	return {
		entries: [] as LibraryEntry[],
		libraryId: 'lib-1',
		showTrashed: false,
		dragEnabled: true,
		draggedFileIds: [] as string[],
		dropTargetFolderId: null,
		renameValue: '',
		isEntrySelected: () => false,
		isRenaming: () => false,
		failedThumbnails: new Set<string>(),
		isImageFile: (f: LibraryFile) => f.mimeType.startsWith('image/'),
		isSmallImage: () => false,
		...over
	};
}

describe('LibraryEntriesGrid', () => {
	it('renders no cards or sections when entries are empty', () => {
		const screen = render(LibraryEntriesGrid, { props: defaultProps() });
		expect(screen.container.querySelectorAll('section')).toHaveLength(0);
		expect(screen.container.querySelectorAll('div[role="button"]')).toHaveLength(0);
	});

	it('renders a folder name', async () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFolder({ name: 'Photos' })] })
		});
		await expect.element(screen.getByText('Photos')).toBeInTheDocument();
	});

	it('renders a file name', async () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFile({ name: 'document.pdf', mimeType: 'application/pdf' })]
			})
		});
		await expect.element(screen.getByText('document.pdf')).toBeInTheDocument();
	});

	it('shows a trashed folder with its file count', async () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFolder({ name: 'Trash Folder', trashFileCount: 5 })],
				showTrashed: true
			})
		});
		await expect.element(screen.getByText('Trash Folder (5 files)')).toBeInTheDocument();
	});

	it('splits folders into a top section and files into a section below', () => {
		const folder = makeFolder({ id: 'f1', name: 'Alpha' });
		const file = makeFile({ id: 'fi1', name: 'beta.jpg' });
		const folder2 = makeFolder({ id: 'f2', name: 'Gamma' });
		// Interleaved input: folder, file, folder — grid must still group them.
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [folder, file, folder2] })
		});
		const sections = screen.container.querySelectorAll('section');
		expect(sections).toHaveLength(2);
		expect(sections[0]!.textContent).toContain('Alpha');
		expect(sections[0]!.textContent).toContain('Gamma');
		expect(sections[0]!.textContent).not.toContain('beta.jpg');
		expect(sections[1]!.textContent).toContain('beta.jpg');
		expect(sections[1]!.textContent).not.toContain('Alpha');
	});

	it('renders only the folder section when there are no files', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFolder({ name: 'Only' })] })
		});
		const sections = screen.container.querySelectorAll('section');
		expect(sections).toHaveLength(1);
		expect(sections[0]!.textContent).toContain('Only');
	});

	it('renders only the file section when there are no folders', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFile({ name: 'lonely.jpg' })] })
		});
		const sections = screen.container.querySelectorAll('section');
		expect(sections).toHaveLength(1);
		expect(sections[0]!.textContent).toContain('lonely.jpg');
	});

	it('applies selected styling when an entry is selected', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFile()], isEntrySelected: () => true })
		});
		const card = screen.container.querySelector('div[role="button"]')!;
		expect(card.className).toContain('bg-primary-500/20');
	});

	it('applies drop-target styling on the target folder', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFolder({ id: 'target-folder' })],
				dropTargetFolderId: 'target-folder'
			})
		});
		const card = screen.container.querySelector('div[role="button"]')!;
		expect(card.className).toContain('ring-2');
	});

	it('applies dragged opacity on dragged files', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFile({ id: 'dragged-file' })],
				draggedFileIds: ['dragged-file']
			})
		});
		const card = screen.container.querySelector('div[role="button"]')!;
		expect(card.className).toContain('opacity-60');
	});

	it('marks file cards draggable but not folder cards', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFolder(), makeFile()], dragEnabled: true })
		});
		const cards = screen.container.querySelectorAll('div[role="button"]');
		// folder section comes first, file section second
		expect(cards[0]!.getAttribute('draggable')).toBe('false');
		expect(cards[1]!.getAttribute('draggable')).toBe('true');
	});

	it('forwards row interaction callbacks from a card', () => {
		const onrowClick = vi.fn();
		const onrowDoubleClick = vi.fn();
		const onrowContextMenu = vi.fn();
		const file = makeFile();
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [file],
				onrowClick,
				onrowDoubleClick,
				onrowContextMenu
			})
		});
		const card = screen.container.querySelector('div[role="button"]')!;
		card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect(onrowClick).toHaveBeenCalledTimes(1);
		expect(onrowClick.mock.calls[0]![0]).toMatchObject({ id: 'file-1' });
		expect(onrowDoubleClick).toHaveBeenCalledTimes(1);
		expect(onrowContextMenu).toHaveBeenCalledTimes(1);
	});

	it('forwards drag lifecycle callbacks from a card', () => {
		const handlers = {
			ondragStart: vi.fn(),
			ondragEnd: vi.fn(),
			ondragEnter: vi.fn(),
			ondragOver: vi.fn(),
			ondragLeave: vi.fn(),
			ondrop: vi.fn()
		};
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFile()], ...handlers })
		});
		const card = screen.container.querySelector('div[role="button"]')!;
		for (const type of ['dragstart', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop']) {
			card.dispatchEvent(new Event(type, { bubbles: true }));
		}
		expect(handlers.ondragStart).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnd).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnter).toHaveBeenCalledTimes(1);
		expect(handlers.ondragOver).toHaveBeenCalledTimes(1);
		expect(handlers.ondragLeave).toHaveBeenCalledTimes(1);
		expect(handlers.ondrop).toHaveBeenCalledTimes(1);
	});

	it('shows a rename input and forwards rename callbacks', () => {
		const onupdateRenameValue = vi.fn();
		const onsaveRename = vi.fn();
		const oncancelRename = vi.fn();
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFile()],
				isRenaming: () => true,
				renameValue: 'new-name.jpg',
				onupdateRenameValue,
				onsaveRename,
				oncancelRename
			})
		});
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id] input'
		) as HTMLInputElement | null;
		expect(input).not.toBeNull();
		expect(input!.value).toBe('new-name.jpg');

		input!.value = 'renamed';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onupdateRenameValue).toHaveBeenCalledWith('renamed');

		input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onsaveRename).toHaveBeenCalledTimes(1);

		input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(oncancelRename).toHaveBeenCalledTimes(1);
	});

	it('renders an image thumbnail for image files', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFile({ id: 'img1', mimeType: 'image/jpeg' })],
				isImageFile: () => true
			})
		});
		const img = screen.container.querySelector('img');
		expect(img).not.toBeNull();
		expect(img!.getAttribute('src')).toContain('/api/files/proxy/lib-1/img1');
	});

	it('renders a processing spinner for an in-progress video proxy', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFile({ mimeType: 'video/mp4', proxyStatus: 'processing' })],
				isImageFile: () => false
			})
		});
		expect(screen.container.querySelector('.animate-spin')).not.toBeNull();
	});

	it('renders tags as colored dots', () => {
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [
					makeFile({
						tags: [
							{ id: 'tag-1', name: 'Important', color: '#ff0000' },
							{ id: 'tag-2', name: 'Work', color: '#00ff00' }
						] as never
					})
				]
			})
		});
		const dots = screen.container.querySelectorAll('.rounded-full[title]');
		expect(dots).toHaveLength(2);
		expect(dots[0]!.getAttribute('title')).toBe('Important');
		expect(dots[1]!.getAttribute('title')).toBe('Work');
	});

	it('forwards onthumbnailError when a thumbnail fails to load', () => {
		const onthumbnailError = vi.fn();
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFile({ id: 'img-fail', mimeType: 'image/jpeg' })],
				isImageFile: () => true,
				onthumbnailError
			})
		});
		const img = screen.container.querySelector('img')!;
		img.dispatchEvent(new Event('error', { bubbles: true }));
		expect(onthumbnailError).toHaveBeenCalledWith('img-fail');
	});

	it('fires each forwarded callback once per card across both sections', () => {
		const onrowClick = vi.fn();
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFolder(), makeFile()], onrowClick })
		});
		const cards = screen.container.querySelectorAll('div[role="button"]');
		expect(cards).toHaveLength(2);
		for (const card of cards) {
			card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		}
		expect(onrowClick).toHaveBeenCalledTimes(2);
	});

	it('forwards row interaction callbacks from a folder card', () => {
		const onrowClick = vi.fn();
		const onrowDoubleClick = vi.fn();
		const onrowContextMenu = vi.fn();
		const folder = makeFolder({ id: 'folder-row' });
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [folder],
				onrowClick,
				onrowDoubleClick,
				onrowContextMenu
			})
		});
		const card = screen.container.querySelector('div[role="button"]')!;
		card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect(onrowClick).toHaveBeenCalledTimes(1);
		expect(onrowClick.mock.calls[0]![0]).toMatchObject({ id: 'folder-row', kind: 'folder' });
		expect(onrowDoubleClick).toHaveBeenCalledTimes(1);
		expect(onrowContextMenu).toHaveBeenCalledTimes(1);
	});

	it('forwards drag lifecycle callbacks from a folder card', () => {
		const handlers = {
			ondragStart: vi.fn(),
			ondragEnd: vi.fn(),
			ondragEnter: vi.fn(),
			ondragOver: vi.fn(),
			ondragLeave: vi.fn(),
			ondrop: vi.fn()
		};
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({ entries: [makeFolder()], ...handlers })
		});
		const card = screen.container.querySelector('div[role="button"]')!;
		for (const type of ['dragstart', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop']) {
			card.dispatchEvent(new Event(type, { bubbles: true }));
		}
		expect(handlers.ondragStart).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnd).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnter).toHaveBeenCalledTimes(1);
		expect(handlers.ondragOver).toHaveBeenCalledTimes(1);
		expect(handlers.ondragLeave).toHaveBeenCalledTimes(1);
		expect(handlers.ondrop).toHaveBeenCalledTimes(1);
	});

	it('forwards rename callbacks from a folder card', () => {
		const onupdateRenameValue = vi.fn();
		const onsaveRename = vi.fn();
		const oncancelRename = vi.fn();
		const screen = render(LibraryEntriesGrid, {
			props: defaultProps({
				entries: [makeFolder({ name: 'Old Folder' })],
				isRenaming: () => true,
				renameValue: 'Old Folder',
				onupdateRenameValue,
				onsaveRename,
				oncancelRename
			})
		});
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id] input'
		) as HTMLInputElement | null;
		expect(input).not.toBeNull();
		expect(input!.value).toBe('Old Folder');

		input!.value = 'Renamed Folder';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onupdateRenameValue).toHaveBeenCalledWith('Renamed Folder');

		input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onsaveRename).toHaveBeenCalledTimes(1);

		input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(oncancelRename).toHaveBeenCalledTimes(1);
	});
});
