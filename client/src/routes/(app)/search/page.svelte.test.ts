import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import SearchPage from './+page.svelte';
import type { GlobalSearchResponse, GlobalSearchResult, LibraryFile } from '$lib/types/api';

// `page` is a live object the route reads via `page.url.searchParams.get('q')`.
// Tests mutate `mockPage.url` to drive the query the page reacts to.
const mockPage = vi.hoisted(() => ({
	url: new URL('http://localhost/search')
}));

const mocks = vi.hoisted(() => ({
	searchQuery: vi.fn(),
	filesGet: vi.fn()
}));

vi.mock('$app/state', () => ({
	page: mockPage
}));

vi.mock('$lib/api', () => ({
	api: {
		search: { query: mocks.searchQuery },
		files: { get: mocks.filesGet }
	},
	apiUrl: (path: string) => path
}));

function makeResult(
	overrides: Partial<GlobalSearchResult> & { id: string; name: string }
): GlobalSearchResult {
	return {
		libraryId: 'lib-1',
		libraryName: 'My Library',
		parentFolderId: null,
		targetFolderId: null,
		kind: 'file',
		locationPath: '/',
		mimeType: 'image/jpeg',
		size: 100,
		updatedAt: '2025-01-01T00:00:00Z',
		...overrides
	};
}

function response(over: Partial<GlobalSearchResponse>): GlobalSearchResponse {
	return { query: '', totalCount: 0, results: [], ...over };
}

describe('search/+page.svelte', () => {
	beforeEach(() => {
		mockPage.url = new URL('http://localhost/search');
		mocks.searchQuery.mockReset();
		mocks.filesGet.mockReset();
	});

	it('shows the minimum-character prompt and does not search for a short query', async () => {
		mockPage.url = new URL('http://localhost/search?q=a');
		const screen = render(SearchPage);
		await tick();
		await expect.element(screen.getByText(/Enter at least 2 characters/)).toBeInTheDocument();
		expect(mocks.searchQuery).not.toHaveBeenCalled();
	});

	it('does not render an in-page search input (header owns the only search bar)', async () => {
		const screen = render(SearchPage);
		await tick();
		expect(screen.container.querySelector('input')).toBeNull();
	});

	it('queries the API and shows total + shown counts when results exist', async () => {
		mocks.searchQuery.mockResolvedValue(
			response({
				query: 'test',
				totalCount: 42,
				results: [makeResult({ id: 'f1', name: 'test.jpg' })]
			})
		);
		mockPage.url = new URL('http://localhost/search?q=test');

		const screen = render(SearchPage);
		await vi.waitFor(() => expect(mocks.searchQuery).toHaveBeenCalled());

		expect(mocks.searchQuery).toHaveBeenCalledWith({ q: 'test', limit: '80' });
		await expect.element(screen.getByText('42 total matches')).toBeInTheDocument();
		await expect.element(screen.getByText('1 shown')).toBeInTheDocument();
	});

	it('groups results by library, surfacing each library name as a heading', async () => {
		mocks.searchQuery.mockResolvedValue(
			response({
				query: 'doc',
				totalCount: 2,
				results: [
					makeResult({ id: 'f1', name: 'doc.jpg', libraryId: 'lib-1', libraryName: 'Library A' }),
					makeResult({ id: 'f2', name: 'readme.png', libraryId: 'lib-2', libraryName: 'Library B' })
				]
			})
		);
		mockPage.url = new URL('http://localhost/search?q=doc');

		const screen = render(SearchPage);
		await vi.waitFor(() => expect(mocks.searchQuery).toHaveBeenCalled());

		await expect.element(screen.getByText('Library A')).toBeInTheDocument();
		await expect.element(screen.getByText('Library B')).toBeInTheDocument();
	});

	it('shows the empty state when a valid query returns no results', async () => {
		mocks.searchQuery.mockResolvedValue(response({ query: 'nope', totalCount: 0, results: [] }));
		mockPage.url = new URL('http://localhost/search?q=nope');

		const screen = render(SearchPage);
		await vi.waitFor(() => expect(mocks.searchQuery).toHaveBeenCalled());

		await expect.element(screen.getByText(/No results found for/)).toBeInTheDocument();
	});

	it('shows the error state when the search request fails', async () => {
		mocks.searchQuery.mockRejectedValue(new Error('boom'));
		mockPage.url = new URL('http://localhost/search?q=boom');

		const screen = render(SearchPage);
		await vi.waitFor(() => expect(mocks.searchQuery).toHaveBeenCalled());

		await expect.element(screen.getByText('Search failed')).toBeInTheDocument();
	});

	it('opens a file preview by fetching the full file when a tile is selected', async () => {
		mocks.searchQuery.mockResolvedValue(
			response({
				query: 'pic',
				totalCount: 1,
				results: [makeResult({ id: 'f1', name: 'pic.jpg', libraryId: 'lib-9' })]
			})
		);
		const fullFile: LibraryFile = {
			id: 'f1',
			libraryId: 'lib-9',
			parentFolderId: null,
			name: 'pic.jpg',
			mimeType: 'image/jpeg',
			size: 100,
			kind: 'file',
			duration: null,
			width: 800,
			height: 600,
			proxyStatus: null,
			thumbnailFileId: null,
			sourceFileId: null,
			originalCreatedAt: null,
			hash: null,
			trashedAt: null,
			createdAt: '2025-01-01T00:00:00Z',
			updatedAt: '2025-01-01T00:00:00Z',
			owner: null,
			tags: []
		};
		mocks.filesGet.mockResolvedValue(fullFile);
		mockPage.url = new URL('http://localhost/search?q=pic');

		const screen = render(SearchPage);
		await vi.waitFor(() => expect(mocks.searchQuery).toHaveBeenCalled());

		// The gallery renders each result as a clickable tile button.
		const tile = await vi.waitFor(() => {
			const btn = screen.container.querySelector('button');
			if (!btn) throw new Error('tile not rendered yet');
			return btn;
		});
		tile.click();

		await vi.waitFor(() => expect(mocks.filesGet).toHaveBeenCalledWith('lib-9', 'f1'));
	});
});
