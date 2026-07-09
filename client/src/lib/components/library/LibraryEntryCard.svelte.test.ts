import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LibraryEntryCard from './LibraryEntryCard.svelte';
import type { LibraryEntry } from '$lib/types/api';

function fileEntry(over: Partial<LibraryEntry> = {}): LibraryEntry {
	return {
		id: 'f1',
		kind: 'file',
		name: 'clip.mp4',
		mimeType: 'video/mp4',
		thumbnailFileId: null,
		proxyStatus: null,
		tags: [],
		...over
	} as LibraryEntry;
}

function folderEntry(over: Partial<LibraryEntry> = {}): LibraryEntry {
	return { id: 'fo1', kind: 'folder', name: 'Trips', tags: [], ...over } as LibraryEntry;
}

function baseProps(entry: LibraryEntry, over: Record<string, unknown> = {}) {
	return {
		entry,
		libraryId: 'lib1',
		showTrashed: false,
		dragEnabled: true,
		draggedFileIds: [] as string[],
		draggedFolderIds: [] as string[],
		dropTargetFolderId: null,
		renameValue: '',
		isEntrySelected: () => false,
		isRenaming: () => false,
		failedThumbnails: new Set<string>(),
		isImageFile: (f: { mimeType: string }) => f.mimeType.startsWith('image/'),
		isSmallImage: () => false,
		...over
	};
}

describe('LibraryEntryCard', () => {
	it('renders a file name', async () => {
		const screen = render(LibraryEntryCard, { props: baseProps(fileEntry()) });
		await expect.element(screen.getByText('clip.mp4')).toBeInTheDocument();
	});

	it('renders a folder name with the trashed file count as muted metadata', async () => {
		const screen = render(LibraryEntryCard, {
			props: baseProps(folderEntry({ trashFileCount: 3 }), { showTrashed: true })
		});
		await expect.element(screen.getByText('Trips')).toBeInTheDocument();
		const meta = screen.getByText('(3 files)');
		await expect.element(meta).toBeInTheDocument();
		expect(meta.element().className).toContain('text-muted-foreground');
	});

	it('fires row interaction callbacks', async () => {
		const onrowClick = vi.fn();
		const onrowDoubleClick = vi.fn();
		const onrowContextMenu = vi.fn();
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry(), { onrowClick, onrowDoubleClick, onrowContextMenu })
		});
		const root = screen.container.querySelector('div[role="button"]')!;
		root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect(onrowClick).toHaveBeenCalledTimes(1);
		expect(onrowDoubleClick).toHaveBeenCalledTimes(1);
		expect(onrowContextMenu).toHaveBeenCalledTimes(1);
	});

	it('fires drag lifecycle callbacks', async () => {
		const handlers = {
			ondragStart: vi.fn(),
			ondragEnd: vi.fn(),
			ondragEnter: vi.fn(),
			ondragOver: vi.fn(),
			ondragLeave: vi.fn(),
			ondrop: vi.fn()
		};
		const screen = render(LibraryEntryCard, { props: baseProps(fileEntry(), handlers) });
		const root = screen.container.querySelector('div[role="button"]')!;
		for (const type of ['dragstart', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop']) {
			root.dispatchEvent(new Event(type, { bubbles: true }));
		}
		expect(handlers.ondragStart).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnd).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnter).toHaveBeenCalledTimes(1);
		expect(handlers.ondragOver).toHaveBeenCalledTimes(1);
		expect(handlers.ondragLeave).toHaveBeenCalledTimes(1);
		expect(handlers.ondrop).toHaveBeenCalledTimes(1);
	});

	it('shows a rename input and forwards rename callbacks', async () => {
		const onupdateRenameValue = vi.fn();
		const onsaveRename = vi.fn();
		const oncancelRename = vi.fn();
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry(), {
				isRenaming: () => true,
				renameValue: 'old',
				onupdateRenameValue,
				onsaveRename,
				oncancelRename
			})
		});
		const input = screen.container.querySelector('input')!;
		expect(input).not.toBeNull();
		expect(input.value).toBe('old');

		input.value = 'new';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onupdateRenameValue).toHaveBeenCalledWith('new');

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onsaveRename).toHaveBeenCalledTimes(1);

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(oncancelRename).toHaveBeenCalledTimes(1);
	});

	it('flags duplicates with a hover title', async () => {
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry({ hasDuplicates: true }))
		});
		const badge = screen.container.querySelector(
			'[title="Duplicate of another file in this library"]'
		);
		expect(badge).not.toBeNull();
	});

	it('renders tag swatches with their color', async () => {
		const screen = render(LibraryEntryCard, {
			props: baseProps(
				fileEntry({ tags: [{ id: 't1', name: 'blue', color: 'rgb(0, 0, 255)' }] as never })
			)
		});
		const swatch = screen.container.querySelector('[title="blue"]') as HTMLElement;
		expect(swatch).not.toBeNull();
		expect(swatch.style.backgroundColor).toBe('rgb(0, 0, 255)');
	});

	it('fires onthumbnailError when the fallback image fails', async () => {
		const onthumbnailError = vi.fn();
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry({ thumbnailFileId: null }), { onthumbnailError })
		});
		const img = screen.container.querySelector('img')!;
		expect(img).not.toBeNull();
		img.dispatchEvent(new Event('error', { bubbles: true }));
		expect(onthumbnailError).toHaveBeenCalledWith('f1');
	});

	it('uses AlcovesImage proxy src for a video with a thumbnail and forwards its error', async () => {
		const onthumbnailError = vi.fn();
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry({ thumbnailFileId: 'thumb-1' }), { onthumbnailError })
		});
		const img = screen.container.querySelector('img')!;
		expect(img.getAttribute('src')).toContain('/api/files/proxy/lib1/thumb-1');
		img.dispatchEvent(new Event('error', { bubbles: true }));
		expect(onthumbnailError).toHaveBeenCalledWith('f1');
	});

	it('shows a processing overlay for a video proxy in progress', async () => {
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry({ thumbnailFileId: null, proxyStatus: 'processing' }))
		});
		expect(screen.container.querySelector('.animate-spin')).not.toBeNull();
	});

	it('shows a duration badge for a video with a known duration', async () => {
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry({ duration: 247 }))
		});
		await expect.element(screen.getByText('4:07')).toBeInTheDocument();
	});

	it('renders an image thumbnail for image files', async () => {
		const screen = render(LibraryEntryCard, {
			props: baseProps(fileEntry({ id: 'img1', name: 'pic.jpg', mimeType: 'image/jpeg' }))
		});
		const img = screen.container.querySelector('img')!;
		expect(img.getAttribute('src')).toContain('/api/files/proxy/lib1/img1');
	});

	it('does not render a thumbnail area for folders', async () => {
		const screen = render(LibraryEntryCard, { props: baseProps(folderEntry()) });
		expect(screen.container.querySelector('img')).toBeNull();
		expect(screen.container.querySelector('.aspect-video')).toBeNull();
	});
});
