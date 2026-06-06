import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryTag, PaginatedFiles } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1' },
		url: new URL('http://localhost/libraries/lib-1/tags'),
		data: {}
	}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

// ─── portal action: keep the toolbar node in place so we can assert on it ─────
vi.mock('$lib/actions/portal', () => ({
	portal: () => ({ update() {}, destroy() {} })
}));

// ─── toast ───────────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn()
}));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

// ─── api mock ─────────────────────────────────────────────────────────────────
// The page drives the *real* createLibraryTags store, which calls $lib/api; the
// page itself also calls api.tags.list + api.files.list. We back all of them with
// a mutable tag list so create/delete reflect in the rendered rows.
const state = vi.hoisted(() => ({
	tags: [] as LibraryTag[]
}));

const apiMock = vi.hoisted(() => ({
	tags: {
		list: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		syncFileTags: vi.fn(),
		syncFolderTags: vi.fn()
	},
	files: {
		list: vi.fn()
	}
}));
vi.mock('$lib/api', () => ({ api: apiMock }));

import Page from './+page.svelte';

function makeTag(id: string, name: string, color = '#E11D48'): LibraryTag {
	return {
		id,
		libraryId: 'lib-1',
		name,
		color,
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z'
	};
}

const emptyFilesPage: PaginatedFiles = {
	entries: [],
	nextCursor: null,
	totalCount: 0,
	breadcrumbs: [],
	currentFolderId: null
};

beforeEach(() => {
	vi.clearAllMocks();
	state.tags = [makeTag('t1', 'Alpha')];

	apiMock.tags.list.mockImplementation(() => Promise.resolve([...state.tags]));
	apiMock.tags.create.mockImplementation(
		(_libraryId: string, body: { name: string; color?: string }) => {
			const created = makeTag('t2', body.name, body.color ?? '#3B82F6');
			state.tags = [...state.tags, created];
			return Promise.resolve(created);
		}
	);
	apiMock.tags.update.mockImplementation(
		(_libraryId: string, tagId: string, body: { name?: string; color?: string }) => {
			const existing = state.tags.find((t) => t.id === tagId)!;
			const updated = { ...existing, ...body };
			state.tags = state.tags.map((t) => (t.id === tagId ? updated : t));
			return Promise.resolve(updated);
		}
	);
	apiMock.tags.delete.mockImplementation((_libraryId: string, tagId: string) => {
		state.tags = state.tags.filter((t) => t.id !== tagId);
		return Promise.resolve();
	});

	// One page of files: a single file tagged with the seed tag → usage count 1.
	apiMock.files.list.mockImplementation(() =>
		Promise.resolve({
			...emptyFilesPage,
			entries: [
				{
					id: 'f1',
					kind: 'file',
					tags: [makeTag('t1', 'Alpha')]
				}
			]
		} as unknown as PaginatedFiles)
	);
});

describe('/libraries/[id]/tags', () => {
	it('renders the tags panel and loads the existing tags', async () => {
		const screen = render(Page);

		await expect.element(screen.getByText('Tags')).toBeInTheDocument();
		await expect.element(screen.getByPlaceholder('Add a tag')).toBeInTheDocument();

		// Loaded the tag list + crawled files for usage counts.
		await vi.waitFor(() => {
			expect(apiMock.tags.list).toHaveBeenCalledWith('lib-1');
		});
		expect(apiMock.files.list).toHaveBeenCalled();

		// The seeded tag's rename input is present with its name.
		const renameInput = screen.getByLabelText('Rename tag Alpha');
		await expect.element(renameInput).toBeInTheDocument();
		await expect.element(renameInput).toHaveValue('Alpha');
	});

	it('shows the usage count for a tag after the crawl', async () => {
		const screen = render(Page);
		// f1 carries tag t1 → "1 item".
		await expect.element(screen.getByText('1 item')).toBeInTheDocument();
	});

	it('creates a tag from the create row', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		const createInput = screen.getByPlaceholder('Add a tag');
		await createInput.fill('Beta');

		await screen.getByRole('button', { name: 'Add tag' }).click();

		await vi.waitFor(() => {
			expect(apiMock.tags.create).toHaveBeenCalledWith('lib-1', {
				name: 'Beta',
				color: '#E11D48'
			});
		});

		// The new row renders.
		await expect.element(screen.getByLabelText('Rename tag Beta')).toBeInTheDocument();
	});

	it('does not create a tag when the name is blank', async () => {
		const screen = render(Page);
		await tick();

		const addButton = screen.getByRole('button', { name: 'Add tag' });
		await expect.element(addButton).toBeDisabled();
		expect(apiMock.tags.create).not.toHaveBeenCalled();
	});

	it('deletes a tag', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Delete tag Alpha' }).click();

		await vi.waitFor(() => {
			expect(apiMock.tags.delete).toHaveBeenCalledWith('lib-1', 't1');
		});
		await expect.element(screen.getByText('No tags yet')).toBeInTheDocument();
	});

	// (The manual "Recount tag usage" toolbar button was removed; usage counts now
	// load once on mount — covered by the count-rendering tests below.)

	it('creates a tag by pressing Enter in the create input', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		const createInput = screen.getByPlaceholder('Add a tag');
		await createInput.fill('Gamma');
		await tick();
		createInput
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

		await vi.waitFor(() => {
			expect(apiMock.tags.create).toHaveBeenCalledWith('lib-1', {
				name: 'Gamma',
				color: '#E11D48'
			});
		});
		await expect.element(screen.getByLabelText('Rename tag Gamma')).toBeInTheDocument();
	});

	it('crawls nested folders, paginates cursors and dedupes entries for usage counts', async () => {
		// Root page: a folder + a file (with cursor → second root page), then a
		// nested folder page that repeats the same file (dedup) plus its own tag.
		apiMock.files.list.mockImplementation(
			(_libraryId: string, query: { folder?: string; cursor?: string }) => {
				if (query.folder === 'folder-1') {
					return Promise.resolve({
						...emptyFilesPage,
						entries: [
							// duplicate of the root file — must be deduped (counted once)
							{ id: 'file-a', kind: 'file', tags: [makeTag('t1', 'Alpha')] },
							{ id: 'file-b', kind: 'file', tags: [makeTag('t1', 'Alpha')] }
						]
					} as unknown as PaginatedFiles);
				}
				if (query.cursor === 'cursor-2') {
					// Second page of the root listing.
					return Promise.resolve({
						...emptyFilesPage,
						entries: [{ id: 'file-c', kind: 'file', tags: [makeTag('t1', 'Alpha')] }],
						nextCursor: null
					} as unknown as PaginatedFiles);
				}
				// First root page: one folder + one file, with a follow-on cursor.
				return Promise.resolve({
					...emptyFilesPage,
					entries: [
						{ id: 'folder-1', kind: 'folder', tags: [] },
						{ id: 'file-a', kind: 'file', tags: [makeTag('t1', 'Alpha')] }
					],
					nextCursor: 'cursor-2'
				} as unknown as PaginatedFiles);
			}
		);

		const screen = render(Page);

		// file-a (root) + file-c (root page 2) + file-b (folder) = 3 distinct, all
		// carry t1. file-a in the folder is a dedup and must not double-count.
		await expect.element(screen.getByText('3 items')).toBeInTheDocument();

		// The folder was enqueued and crawled with its folder id in the query.
		await vi.waitFor(() => {
			expect(apiMock.files.list).toHaveBeenCalledWith(
				'lib-1',
				expect.objectContaining({ folder: 'folder-1' })
			);
		});
		// Pagination followed the cursor.
		expect(apiMock.files.list).toHaveBeenCalledWith(
			'lib-1',
			expect.objectContaining({ cursor: 'cursor-2' })
		);
	});

	it('shows a toast when the usage crawl fails', async () => {
		apiMock.files.list.mockRejectedValue(new Error('boom'));

		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		await vi.waitFor(() => {
			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Failed to load tag usage counts',
				color: 'error'
			});
		});
	});

	it('shows a toast when the initial tag list load fails', async () => {
		apiMock.tags.list.mockRejectedValue(new Error('nope'));

		render(Page);

		await vi.waitFor(() => {
			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to load tags', color: 'error' });
		});
	});

	it('renames a tag via blur of the rename input', async () => {
		const screen = render(Page);
		const renameInput = screen.getByLabelText('Rename tag Alpha');
		await expect.element(renameInput).toBeInTheDocument();

		await renameInput.fill('Alpha Renamed');
		await renameInput.element().dispatchEvent(new FocusEvent('blur'));

		await vi.waitFor(() => {
			expect(apiMock.tags.update).toHaveBeenCalledWith('lib-1', 't1', { name: 'Alpha Renamed' });
		});
		await expect.element(screen.getByLabelText('Rename tag Alpha Renamed')).toBeInTheDocument();
	});

	it('blurs the rename input on Enter so the name persists', async () => {
		const screen = render(Page);
		const renameInput = screen.getByLabelText('Rename tag Alpha');
		await expect.element(renameInput).toBeInTheDocument();

		await renameInput.fill('Alpha Two');
		const el = renameInput.element() as HTMLInputElement;
		el.focus();
		el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		// Enter calls blur(), which fires the save.
		el.dispatchEvent(new FocusEvent('blur'));

		await vi.waitFor(() => {
			expect(apiMock.tags.update).toHaveBeenCalledWith('lib-1', 't1', { name: 'Alpha Two' });
		});
	});

	it('opens the create color dropdown and picks a palette color', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		// Open the create-row color dropdown.
		await screen.getByTitle('Choose new tag color').click();

		// The palette panel renders; pick a non-default color.
		const swatch = screen.getByTitle('#22C55E');
		await expect.element(swatch).toBeInTheDocument();
		await swatch.click();

		// Picking sets createTagColor; the next created tag carries it.
		const createInput = screen.getByPlaceholder('Add a tag');
		await createInput.fill('Greeny');
		await screen.getByRole('button', { name: 'Add tag' }).click();

		await vi.waitFor(() => {
			expect(apiMock.tags.create).toHaveBeenCalledWith('lib-1', {
				name: 'Greeny',
				color: '#22C55E'
			});
		});
	});

	it('toggles the create color dropdown closed when clicked again', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		const trigger = screen.getByTitle('Choose new tag color');
		await trigger.click();
		await expect.element(screen.getByTitle('#22C55E')).toBeInTheDocument();

		// Click again → toggleColorDropdown collapses it.
		await trigger.click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[title="#22C55E"]')).toBeNull();
		});
	});

	it('commits a valid hex draft from the create color input', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		await screen.getByTitle('Choose new tag color').click();

		// The dropdown hosts a hex input (placeholder #3B82F6). Type a 3-char hex
		// to exercise the shorthand-expansion branch of normalizeHexColor.
		const hexInput = screen.container.querySelector(
			'input[placeholder="#3B82F6"]'
		) as HTMLInputElement;
		expect(hexInput).not.toBeNull();
		hexInput.value = 'abc';
		hexInput.dispatchEvent(new Event('input', { bubbles: true }));
		hexInput.dispatchEvent(new FocusEvent('blur'));
		await tick();

		const createInput = screen.getByPlaceholder('Add a tag');
		await createInput.fill('Hexy');
		await screen.getByRole('button', { name: 'Add tag' }).click();

		await vi.waitFor(() => {
			expect(apiMock.tags.create).toHaveBeenCalledWith('lib-1', {
				name: 'Hexy',
				color: '#AABBCC'
			});
		});
	});

	it('rejects an invalid hex draft from the create color input', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		await screen.getByTitle('Choose new tag color').click();

		const hexInput = screen.container.querySelector(
			'input[placeholder="#3B82F6"]'
		) as HTMLInputElement;
		hexInput.value = 'nothex';
		hexInput.dispatchEvent(new Event('input', { bubbles: true }));
		hexInput.dispatchEvent(new FocusEvent('blur'));
		await tick();

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Color must be a valid hex code',
			color: 'error'
		});
	});

	it('updates a tag color by picking from its row dropdown', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		// Each row has a color trigger ("Select tag color"); the seed tag is first.
		const triggers = screen.container.querySelectorAll('button[title="Select tag color"]');
		expect(triggers.length).toBeGreaterThan(0);
		(triggers[0] as HTMLButtonElement).click();
		await tick();

		await screen.getByTitle('#06B6D4').click();

		await vi.waitFor(() => {
			expect(apiMock.tags.update).toHaveBeenCalledWith('lib-1', 't1', { color: '#06B6D4' });
		});
	});

	it('commits a valid hex draft from a tag row color input', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		const triggers = screen.container.querySelectorAll('button[title="Select tag color"]');
		(triggers[0] as HTMLButtonElement).click();
		await tick();

		const hexInput = screen.container.querySelector(
			'input[placeholder="#3B82F6"]'
		) as HTMLInputElement;
		expect(hexInput).not.toBeNull();
		hexInput.value = '#123456';
		hexInput.dispatchEvent(new Event('input', { bubbles: true }));
		hexInput.dispatchEvent(new FocusEvent('blur'));
		await tick();

		await vi.waitFor(() => {
			expect(apiMock.tags.update).toHaveBeenCalledWith('lib-1', 't1', { color: '#123456' });
		});
	});

	it('rejects an invalid hex draft from a tag row color input', async () => {
		const screen = render(Page);
		await expect.element(screen.getByLabelText('Rename tag Alpha')).toBeInTheDocument();

		const triggers = screen.container.querySelectorAll('button[title="Select tag color"]');
		(triggers[0] as HTMLButtonElement).click();
		await tick();

		const hexInput = screen.container.querySelector(
			'input[placeholder="#3B82F6"]'
		) as HTMLInputElement;
		hexInput.value = 'zzz';
		hexInput.dispatchEvent(new Event('input', { bubbles: true }));
		hexInput.dispatchEvent(new FocusEvent('blur'));
		await tick();

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Color must be a valid hex code',
			color: 'error'
		});
	});
});
