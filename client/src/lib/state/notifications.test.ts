import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Activity, NotificationsResponse } from '$lib/types/api';

// The store binds its `apiFetch` once at module load via `makeApiFetch(...)`, so
// the mock returns a single stable mock fn that every call routes through.
const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/fetch', () => ({
	makeApiFetch: () => apiFetchMock
}));

import { notifications } from './notifications.svelte';

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
		createdAt: new Date().toISOString(),
		dismissed: false
	};
}

beforeEach(() => {
	apiFetchMock.mockReset();
	notifications.reset();
});

describe('notifications store', () => {
	it('starts empty', () => {
		expect(notifications.entries).toEqual([]);
		expect(notifications.unreadCount).toBe(0);
		expect(notifications.nextCursor).toBeNull();
		expect(notifications.loading).toBe(false);
		expect(notifications.loadingMore).toBe(false);
		expect(notifications.error).toBeNull();
	});

	it('loadFirst populates entries, cursor, and unreadCount', async () => {
		apiFetchMock.mockResolvedValueOnce({
			entries: [makeActivity('a1'), makeActivity('a2')],
			nextCursor: 'cursor-1',
			unreadCount: 2
		} satisfies NotificationsResponse);

		await notifications.loadFirst();

		expect(notifications.entries).toHaveLength(2);
		expect(notifications.nextCursor).toBe('cursor-1');
		expect(notifications.unreadCount).toBe(2);
		expect(notifications.loading).toBe(false);
		expect(notifications.error).toBeNull();
		expect(apiFetchMock).toHaveBeenCalledWith('/api/notifications', { query: {} });
	});

	it('loadFirst forwards a cursor query of {} on the first page', async () => {
		apiFetchMock.mockResolvedValueOnce({ entries: [], nextCursor: null, unreadCount: 0 });
		await notifications.loadFirst();
		expect(apiFetchMock).toHaveBeenCalledWith('/api/notifications', { query: {} });
	});

	it('loadFirst records the error message and clears loading on failure', async () => {
		apiFetchMock.mockRejectedValueOnce(new Error('boom'));
		await notifications.loadFirst();
		expect(notifications.error).toBe('boom');
		expect(notifications.loading).toBe(false);
		expect(notifications.entries).toEqual([]);
	});

	it('loadMore appends entries and bumps the cursor', async () => {
		apiFetchMock
			.mockResolvedValueOnce({ entries: [makeActivity('a1')], nextCursor: 'c1', unreadCount: 1 })
			.mockResolvedValueOnce({ entries: [makeActivity('a2')], nextCursor: null, unreadCount: 1 });

		await notifications.loadFirst();
		await notifications.loadMore();

		expect(notifications.entries.map((e) => e.id)).toEqual(['a1', 'a2']);
		expect(notifications.nextCursor).toBeNull();
		expect(notifications.loadingMore).toBe(false);
		expect(apiFetchMock).toHaveBeenLastCalledWith('/api/notifications', {
			query: { cursor: 'c1' }
		});
	});

	it('loadMore is a no-op without a nextCursor', async () => {
		apiFetchMock.mockResolvedValueOnce({
			entries: [makeActivity('a1')],
			nextCursor: null,
			unreadCount: 1
		});
		await notifications.loadFirst();
		apiFetchMock.mockClear();
		await notifications.loadMore();
		expect(apiFetchMock).not.toHaveBeenCalled();
	});

	it('loadMore is a no-op while already loading more', async () => {
		apiFetchMock.mockResolvedValueOnce({ entries: [], nextCursor: 'c1', unreadCount: 0 });
		await notifications.loadFirst();

		// A second page that never resolves keeps loadingMore = true.
		apiFetchMock.mockReturnValueOnce(new Promise(() => {}));
		const first = notifications.loadMore();
		expect(notifications.loadingMore).toBe(true);

		apiFetchMock.mockClear();
		await notifications.loadMore(); // re-entrant call bails out
		expect(apiFetchMock).not.toHaveBeenCalled();
		void first;
	});

	it('loadMore records the error message and clears loadingMore on failure', async () => {
		apiFetchMock.mockResolvedValueOnce({ entries: [], nextCursor: 'c1', unreadCount: 0 });
		await notifications.loadFirst();
		apiFetchMock.mockRejectedValueOnce(new Error('page fail'));
		await notifications.loadMore();
		expect(notifications.error).toBe('page fail');
		expect(notifications.loadingMore).toBe(false);
	});

	it('dismiss removes the row optimistically and decrements unread', async () => {
		apiFetchMock
			.mockResolvedValueOnce({
				entries: [makeActivity('a1'), makeActivity('a2')],
				nextCursor: null,
				unreadCount: 2
			})
			.mockResolvedValueOnce(undefined);

		await notifications.loadFirst();
		await notifications.dismiss('a1');

		expect(notifications.entries.map((e) => e.id)).toEqual(['a2']);
		expect(notifications.unreadCount).toBe(1);
		expect(apiFetchMock).toHaveBeenLastCalledWith('/api/notifications/a1/dismiss', {
			method: 'POST'
		});
	});

	it('dismiss does not push unreadCount below zero', async () => {
		apiFetchMock
			.mockResolvedValueOnce({ entries: [makeActivity('a1')], nextCursor: null, unreadCount: 0 })
			.mockResolvedValueOnce(undefined);
		await notifications.loadFirst();
		await notifications.dismiss('a1');
		expect(notifications.unreadCount).toBe(0);
	});

	it('dismiss of an unknown id leaves entries intact but still calls the API', async () => {
		apiFetchMock
			.mockResolvedValueOnce({ entries: [makeActivity('a1')], nextCursor: null, unreadCount: 1 })
			.mockResolvedValueOnce(undefined);
		await notifications.loadFirst();
		await notifications.dismiss('nope');
		expect(notifications.entries.map((e) => e.id)).toEqual(['a1']);
		// unreadCount still decremented (matches the Vue version's behavior).
		expect(notifications.unreadCount).toBe(0);
		expect(apiFetchMock).toHaveBeenLastCalledWith('/api/notifications/nope/dismiss', {
			method: 'POST'
		});
	});

	it('dismiss records the error message when the API call fails', async () => {
		apiFetchMock
			.mockResolvedValueOnce({ entries: [makeActivity('a1')], nextCursor: null, unreadCount: 1 })
			.mockRejectedValueOnce(new Error('dismiss fail'));
		await notifications.loadFirst();
		await notifications.dismiss('a1');
		expect(notifications.error).toBe('dismiss fail');
		// Optimistic removal still happened.
		expect(notifications.entries).toEqual([]);
	});

	it('dismissAll clears entries and resets unreadCount to 0', async () => {
		apiFetchMock
			.mockResolvedValueOnce({
				entries: [makeActivity('a1'), makeActivity('a2')],
				nextCursor: null,
				unreadCount: 2
			})
			.mockResolvedValueOnce(undefined);

		await notifications.loadFirst();
		await notifications.dismissAll();

		expect(notifications.entries).toHaveLength(0);
		expect(notifications.unreadCount).toBe(0);
		expect(apiFetchMock).toHaveBeenLastCalledWith('/api/notifications/dismiss-all', {
			method: 'POST'
		});
	});

	it('dismissAll records the error message when the API call fails', async () => {
		apiFetchMock.mockRejectedValueOnce(new Error('clear fail'));
		await notifications.dismissAll();
		expect(notifications.error).toBe('clear fail');
		// State was still cleared optimistically.
		expect(notifications.entries).toEqual([]);
		expect(notifications.unreadCount).toBe(0);
	});

	it('refreshUnreadCount updates only the badge', async () => {
		apiFetchMock.mockResolvedValueOnce({ unreadCount: 7 });
		await notifications.refreshUnreadCount();
		expect(notifications.unreadCount).toBe(7);
		expect(apiFetchMock).toHaveBeenCalledWith('/api/notifications/unread-count');
	});

	it('refreshUnreadCount swallows errors and leaves the badge unchanged', async () => {
		apiFetchMock.mockResolvedValueOnce({
			entries: [makeActivity('a1'), makeActivity('a2')],
			nextCursor: null,
			unreadCount: 2
		});
		await notifications.loadFirst();
		apiFetchMock.mockRejectedValueOnce(new Error('transient'));
		await notifications.refreshUnreadCount();
		expect(notifications.unreadCount).toBe(2);
		expect(notifications.error).toBeNull();
	});

	it('prependLive adds a fresh activity and bumps unread', () => {
		notifications.prependLive(makeActivity('new-1'));
		expect(notifications.entries[0].id).toBe('new-1');
		expect(notifications.unreadCount).toBe(1);
	});

	it('prependLive keeps newest-first ordering', () => {
		notifications.prependLive(makeActivity('one'));
		notifications.prependLive(makeActivity('two'));
		expect(notifications.entries.map((e) => e.id)).toEqual(['two', 'one']);
		expect(notifications.unreadCount).toBe(2);
	});

	it('prependLive dedupes by id', () => {
		notifications.prependLive(makeActivity('dup'));
		notifications.prependLive(makeActivity('dup'));
		expect(notifications.entries).toHaveLength(1);
		expect(notifications.unreadCount).toBe(1); // only the first push bumped it
	});

	it('reset returns the store to its initial state', async () => {
		apiFetchMock.mockResolvedValueOnce({
			entries: [makeActivity('a1')],
			nextCursor: 'c1',
			unreadCount: 1
		});
		await notifications.loadFirst();
		notifications.reset();
		expect(notifications.entries).toEqual([]);
		expect(notifications.unreadCount).toBe(0);
		expect(notifications.nextCursor).toBeNull();
		expect(notifications.loading).toBe(false);
		expect(notifications.loadingMore).toBe(false);
		expect(notifications.error).toBeNull();
	});
});
