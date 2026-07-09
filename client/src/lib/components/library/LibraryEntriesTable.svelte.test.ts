import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LibraryEntriesTable from './LibraryEntriesTable.svelte';
import type { LibraryEntry, LibraryFile, LibraryFolder } from '$lib/types/api';

function makeFolder(over: Partial<LibraryFolder> = {}): LibraryFolder {
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
		...over
	};
}

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id: 'file-1',
		libraryId: 'lib-1',
		parentFolderId: null,
		name: 'photo.jpg',
		mimeType: 'image/jpeg',
		size: 1048576,
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
		updatedAt: '2024-01-15',
		owner: null,
		tags: [],
		...over
	};
}

function baseProps(over: Record<string, unknown> = {}) {
	return {
		entries: [] as LibraryEntry[],
		showTrashed: false,
		dragEnabled: true,
		draggedFileIds: [] as string[],
		draggedFolderIds: [] as string[],
		dropTargetFolderId: null,
		renameValue: '',
		isEntrySelected: () => false,
		isRenaming: () => false,
		...over
	};
}

describe('LibraryEntriesTable', () => {
	it('renders table headers', async () => {
		const screen = render(LibraryEntriesTable, { props: baseProps() });
		await expect.element(screen.getByText('Name')).toBeInTheDocument();
		await expect.element(screen.getByText('Tags')).toBeInTheDocument();
		await expect.element(screen.getByText('Owner')).toBeInTheDocument();
		await expect.element(screen.getByText('Modified')).toBeInTheDocument();
		await expect.element(screen.getByText('Size')).toBeInTheDocument();
	});

	it('shows the Trashed header when showTrashed is true', async () => {
		const screen = render(LibraryEntriesTable, { props: baseProps({ showTrashed: true }) });
		await expect.element(screen.getByText('Trashed')).toBeInTheDocument();
		expect(screen.container.textContent).not.toContain('Modified');
	});

	it('renders a folder entry name', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFolder({ name: 'Documents' })] })
		});
		await expect.element(screen.getByText('Documents')).toBeInTheDocument();
	});

	it('renders a file entry name and formatted size', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile({ name: 'image.png', size: 1048576 })] })
		});
		await expect.element(screen.getByText('image.png')).toBeInTheDocument();
		expect(screen.container.textContent).toMatch(/1(\.0)?\s*MB/);
	});

	it('shows a dash for folder size', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFolder()] })
		});
		const tds = screen.container.querySelectorAll('tbody td');
		const lastTd = tds[tds.length - 1]!;
		expect(lastTd.textContent?.trim()).toBe('-');
	});

	it('shows a trashed folder with its file count', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({
				entries: [makeFolder({ name: 'Old Stuff', trashFileCount: 3 })],
				showTrashed: true
			})
		});
		await expect.element(screen.getByText('Old Stuff (3 files)')).toBeInTheDocument();
	});

	it('applies selected styling when an entry is selected', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile()], isEntrySelected: () => true })
		});
		const row = screen.container.querySelector('tbody tr')!;
		expect(row.className).toContain('bg-primary/20');
	});

	it('applies drop-target styling on a folder', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({
				entries: [makeFolder({ id: 'drop-target' })],
				dropTargetFolderId: 'drop-target'
			})
		});
		const row = screen.container.querySelector('tbody tr')!;
		expect(row.className).toContain('ring-2');
	});

	it('applies dragged opacity on a dragged file', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile({ id: 'dragged' })], draggedFileIds: ['dragged'] })
		});
		const row = screen.container.querySelector('tbody tr')!;
		expect(row.className).toContain('opacity-60');
	});

	it('fires row interaction callbacks', async () => {
		const onrowClick = vi.fn();
		const onrowDoubleClick = vi.fn();
		const onrowContextMenu = vi.fn();
		const file = makeFile();
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [file], onrowClick, onrowDoubleClick, onrowContextMenu })
		});
		const row = screen.container.querySelector('tbody tr')!;
		row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		expect(onrowClick).toHaveBeenCalledTimes(1);
		expect(onrowClick.mock.calls[0][0]).toEqual(file);
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
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile()], ...handlers })
		});
		const row = screen.container.querySelector('tbody tr')!;
		for (const type of ['dragstart', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop']) {
			row.dispatchEvent(new Event(type, { bubbles: true }));
		}
		expect(handlers.ondragStart).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnd).toHaveBeenCalledTimes(1);
		expect(handlers.ondragEnter).toHaveBeenCalledTimes(1);
		expect(handlers.ondragOver).toHaveBeenCalledTimes(1);
		expect(handlers.ondragLeave).toHaveBeenCalledTimes(1);
		expect(handlers.ondrop).toHaveBeenCalledTimes(1);
	});

	it('shows a rename input with the rename value when isRenaming is true', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({
				entries: [makeFile()],
				isRenaming: () => true,
				renameValue: 'new-name.jpg'
			})
		});
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id] input'
		) as HTMLInputElement;
		expect(input).not.toBeNull();
		expect(input.value).toBe('new-name.jpg');
	});

	it('forwards rename callbacks (input, Enter, Escape)', async () => {
		const onupdateRenameValue = vi.fn();
		const onsaveRename = vi.fn();
		const oncancelRename = vi.fn();
		const screen = render(LibraryEntriesTable, {
			props: baseProps({
				entries: [makeFile()],
				isRenaming: () => true,
				renameValue: 'renamed',
				onupdateRenameValue,
				onsaveRename,
				oncancelRename
			})
		});
		const input = screen.container.querySelector(
			'[data-rename-input-entry-id] input'
		) as HTMLInputElement;
		input.value = 'changed';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onupdateRenameValue).toHaveBeenCalledWith('changed');

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onsaveRename).toHaveBeenCalledTimes(1);

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(oncancelRename).toHaveBeenCalledTimes(1);
	});

	it('renders an owner avatar when the entry has an owner', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({
				entries: [makeFile({ owner: { id: 'u1', displayName: 'Alice', avatarUrl: null } })]
			})
		});
		const ownerCell = screen.container.querySelectorAll('tbody td')[3]!;
		expect(ownerCell.textContent?.trim()).not.toBe('-');
	});

	it('renders a dash when the entry has no owner', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile({ owner: null })] })
		});
		const ownerCell = screen.container.querySelectorAll('tbody td')[3]!;
		expect(ownerCell.textContent?.trim()).toBe('-');
	});

	it('renders tags as colored dots', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({
				entries: [
					makeFile({
						tags: [
							{
								id: 't1',
								libraryId: 'lib-1',
								name: 'Tag1',
								color: 'rgb(255, 0, 0)',
								createdAt: '',
								updatedAt: ''
							}
						]
					})
				]
			})
		});
		const dot = screen.container.querySelector('[title="Tag1"]') as HTMLElement;
		expect(dot).not.toBeNull();
		expect(dot.style.backgroundColor).toBe('rgb(255, 0, 0)');
	});

	it('marks file entries draggable when drag is enabled', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile()], dragEnabled: true })
		});
		const row = screen.container.querySelector('tbody tr')!;
		expect(row.getAttribute('draggable')).toBe('true');
	});

	it('marks folders draggable so they can be moved into other folders', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFolder()], dragEnabled: true })
		});
		const row = screen.container.querySelector('tbody tr')!;
		expect(row.getAttribute('draggable')).toBe('true');
	});

	it('dims a folder row that is being dragged', async () => {
		const folder = makeFolder({ id: 'fdrag' });
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [folder], dragEnabled: true, draggedFolderIds: ['fdrag'] })
		});
		const row = screen.container.querySelector('tbody tr')!;
		expect(row.getAttribute('class')).toContain('opacity-60');
	});

	it('flags duplicate files with a hover title', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile({ hasDuplicates: true })] })
		});
		const badge = screen.container.querySelector(
			'[title="Duplicate of another file in this library"]'
		);
		expect(badge).not.toBeNull();
	});

	it('applies reduced opacity to trashed file names', async () => {
		const screen = render(LibraryEntriesTable, {
			props: baseProps({ entries: [makeFile({ name: 'deleted.jpg' })], showTrashed: true })
		});
		const nameSpan = screen.container.querySelector('span.opacity-60') as HTMLElement;
		expect(nameSpan).not.toBeNull();
		expect(nameSpan.textContent?.trim()).toBe('deleted.jpg');
	});
});
