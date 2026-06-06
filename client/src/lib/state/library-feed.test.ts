import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Activity, LibraryFeedResponse } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	libraries: {
		feed: vi.fn()
	}
}));

vi.mock('$lib/api', () => ({ api: apiMock }));

import { createLibraryFeed } from './library-feed.svelte';

function makeActivity(id: string): Activity {
	return {
		id,
		libraryId: 'lib-1',
		libraryName: 'L',
		actor: { id: 'u1', displayName: 'Alice', avatarUrl: null },
		action: 'file.created',
		subjectType: 'file',
		subjectId: 'f1',
		metadata: { name: id },
		createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
		dismissed: false
	};
}

function page(entries: Activity[], nextCursor: string | null): LibraryFeedResponse {
	return { entries, nextCursor };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createLibraryFeed', () => {
	it('starts with empty state', () => {
		const feed = createLibraryFeed(() => 'lib-1');
		expect(feed.entries).toEqual([]);
		expect(feed.nextCursor).toBeNull();
		expect(feed.loading).toBe(false);
		expect(feed.loadingMore).toBe(false);
		expect(feed.error).toBeNull();
	});

	it('loadFirst fetches and populates entries', async () => {
		apiMock.libraries.feed.mockResolvedValueOnce(
			page([makeActivity('1'), makeActivity('2')], 'c1')
		);

		const feed = createLibraryFeed(() => 'lib-1');
		await feed.loadFirst();

		expect(feed.entries).toHaveLength(2);
		expect(feed.nextCursor).toBe('c1');
		expect(feed.loading).toBe(false);
		expect(feed.error).toBeNull();
		expect(apiMock.libraries.feed).toHaveBeenCalledWith('lib-1', {});
	});

	it('reads the libraryId getter lazily on each call', async () => {
		let id = 'lib-1';
		apiMock.libraries.feed.mockResolvedValue(page([], null));
		const feed = createLibraryFeed(() => id);

		await feed.loadFirst();
		expect(apiMock.libraries.feed).toHaveBeenLastCalledWith('lib-1', {});

		id = 'lib-2';
		await feed.loadFirst();
		expect(apiMock.libraries.feed).toHaveBeenLastCalledWith('lib-2', {});
	});

	it('loadMore passes the cursor and appends entries', async () => {
		apiMock.libraries.feed
			.mockResolvedValueOnce(page([makeActivity('1')], 'c1'))
			.mockResolvedValueOnce(page([makeActivity('2')], null));

		const feed = createLibraryFeed(() => 'lib-1');
		await feed.loadFirst();
		await feed.loadMore();

		expect(apiMock.libraries.feed).toHaveBeenLastCalledWith('lib-1', { cursor: 'c1' });
		expect(feed.entries.map((e) => e.id)).toEqual(['1', '2']);
		expect(feed.nextCursor).toBeNull();
		expect(feed.loadingMore).toBe(false);
	});

	it('loadMore is a no-op when there is no nextCursor', async () => {
		apiMock.libraries.feed.mockResolvedValueOnce(page([makeActivity('1')], null));
		const feed = createLibraryFeed(() => 'lib-1');
		await feed.loadFirst();
		expect(apiMock.libraries.feed).toHaveBeenCalledTimes(1);

		await feed.loadMore();
		// Still only the first-page call — no cursor means nothing more to load.
		expect(apiMock.libraries.feed).toHaveBeenCalledTimes(1);
	});

	it('loadMore is a no-op while a previous loadMore is in flight', async () => {
		// First page yields a cursor so loadMore is eligible.
		apiMock.libraries.feed.mockResolvedValueOnce(page([makeActivity('1')], 'c1'));
		const feed = createLibraryFeed(() => 'lib-1');
		await feed.loadFirst();

		// Make the next loadMore hang so loadingMore stays true.
		let resolveSecond!: (v: LibraryFeedResponse) => void;
		apiMock.libraries.feed.mockReturnValueOnce(
			new Promise<LibraryFeedResponse>((res) => {
				resolveSecond = res;
			})
		);

		const first = feed.loadMore();
		expect(feed.loadingMore).toBe(true);
		// Concurrent call should bail immediately without a second fetch.
		await feed.loadMore();
		expect(apiMock.libraries.feed).toHaveBeenCalledTimes(2);

		resolveSecond(page([makeActivity('2')], null));
		await first;
		expect(feed.loadingMore).toBe(false);
		expect(feed.entries.map((e) => e.id)).toEqual(['1', '2']);
	});

	it('prependLive inserts at the top and dedupes by id', async () => {
		apiMock.libraries.feed.mockResolvedValueOnce(page([makeActivity('existing')], null));
		const feed = createLibraryFeed(() => 'lib-1');
		await feed.loadFirst();

		feed.prependLive(makeActivity('new'));
		expect(feed.entries.map((e) => e.id)).toEqual(['new', 'existing']);

		// Duplicate id is ignored.
		feed.prependLive(makeActivity('new'));
		expect(feed.entries.map((e) => e.id)).toEqual(['new', 'existing']);
	});

	it('prependLive works before any load', () => {
		const feed = createLibraryFeed(() => 'lib-1');
		feed.prependLive(makeActivity('x'));
		feed.prependLive(makeActivity('x'));
		expect(feed.entries).toHaveLength(1);
	});

	it('captures the error message and resets loading on a failed loadFirst', async () => {
		apiMock.libraries.feed.mockRejectedValueOnce(new Error('boom'));
		const feed = createLibraryFeed(() => 'lib-1');
		await feed.loadFirst();
		expect(feed.error).toBe('boom');
		expect(feed.entries).toHaveLength(0);
		expect(feed.loading).toBe(false);
	});

	it('captures the error message and resets loadingMore on a failed loadMore', async () => {
		apiMock.libraries.feed
			.mockResolvedValueOnce(page([makeActivity('1')], 'c1'))
			.mockRejectedValueOnce(new Error('page failed'));

		const feed = createLibraryFeed(() => 'lib-1');
		await feed.loadFirst();
		await feed.loadMore();

		expect(feed.error).toBe('page failed');
		expect(feed.loadingMore).toBe(false);
		// The already-loaded first page is preserved on a loadMore failure.
		expect(feed.entries.map((e) => e.id)).toEqual(['1']);
		expect(feed.nextCursor).toBe('c1');
	});
});
