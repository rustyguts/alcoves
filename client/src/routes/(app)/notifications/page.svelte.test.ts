import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Activity } from '$lib/types/api';

// Mock navigation — capture goto calls.
const goto = vi.fn();
vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => goto(...args)
}));

// Mock the global notifications store. It is a singleton with $state-backed
// fields; here we expose a plain object whose fields the test mutates before
// each render, plus spy methods. `vi.hoisted` shares the handles with the
// hoisted `vi.mock` factory.
const { store, loadFirst, loadMore, dismiss, dismissAll, prependLive } = vi.hoisted(() => {
	const loadFirst = vi.fn(() => Promise.resolve());
	const loadMore = vi.fn(() => Promise.resolve());
	const dismiss = vi.fn();
	const dismissAll = vi.fn(() => Promise.resolve());
	const prependLive = vi.fn();
	return {
		loadFirst,
		loadMore,
		dismiss,
		dismissAll,
		prependLive,
		store: {
			entries: [] as Activity[],
			loading: false,
			loadingMore: false,
			nextCursor: null as string | null,
			loadFirst,
			loadMore,
			dismiss,
			dismissAll,
			prependLive
		}
	};
});

vi.mock('$lib/state/notifications.svelte', () => ({
	notifications: store
}));

// Mock the socket — record the activity handler so we can drive prependLive.
const { socket, connect, onActivity, unsubscribe } = vi.hoisted(() => {
	const unsubscribe = vi.fn();
	const onActivity = vi.fn((_handler: (a: Activity) => void) => unsubscribe);
	const connect = vi.fn();
	return {
		unsubscribe,
		onActivity,
		connect,
		socket: { connect, onActivity, disconnect: vi.fn() }
	};
});

vi.mock('$lib/state/notifications-socket.svelte', () => ({
	notificationsSocket: socket
}));

import Page from './+page.svelte';

function makeActivity(id: string, overrides: Partial<Activity> = {}): Activity {
	return {
		id,
		libraryId: 'lib1',
		libraryName: 'Family Photos',
		actor: { id: 'u', displayName: 'Alice', avatarUrl: null },
		action: 'file.created',
		subjectType: 'file',
		subjectId: 'f',
		metadata: { name: id },
		createdAt: '2026-01-01T00:00:00Z',
		dismissed: false,
		...overrides
	} as Activity;
}

beforeEach(() => {
	goto.mockClear();
	loadFirst.mockClear();
	loadMore.mockClear();
	dismiss.mockClear();
	dismissAll.mockClear();
	prependLive.mockClear();
	connect.mockClear();
	onActivity.mockClear();
	unsubscribe.mockClear();
	store.entries = [];
	store.loading = false;
	store.loadingMore = false;
	store.nextCursor = null;
});

describe('/notifications page', () => {
	it('loads the first page and connects the socket on mount', async () => {
		render(Page);
		expect(loadFirst).toHaveBeenCalledTimes(1);
		expect(connect).toHaveBeenCalledTimes(1);
		expect(onActivity).toHaveBeenCalledTimes(1);
	});

	it('prepends live activities through the socket handler', async () => {
		render(Page);
		const handler = onActivity.mock.calls[0][0] as unknown as (a: Activity) => void;
		const live = makeActivity('live1');
		handler(live);
		expect(prependLive).toHaveBeenCalledWith(live);
	});

	it('shows the loading state on first load', async () => {
		store.loading = true;
		const screen = render(Page);
		await expect.element(screen.getByText('Loading…')).toBeInTheDocument();
	});

	it('shows the empty state when there are no notifications', async () => {
		const screen = render(Page);
		await expect.element(screen.getByText("You're all caught up")).toBeInTheDocument();
	});

	it('renders the header and groups rows under their library name', async () => {
		store.entries = [makeActivity('a1'), makeActivity('a2')];
		const screen = render(Page);
		await expect
			.element(screen.getByRole('heading', { name: 'Notifications' }))
			.toBeInTheDocument();
		await expect.element(screen.getByText('Family Photos')).toBeInTheDocument();
		// Each notification row deep-links into the library.
		expect(screen.container.querySelector('a[href^="/libraries/lib1"]')).not.toBeNull();
	});

	it('dismisses all when the header button is clicked', async () => {
		store.entries = [makeActivity('a1')];
		const screen = render(Page);
		const dismissAllBtn = screen.getByRole('button', { name: 'Dismiss all' });
		await expect.element(dismissAllBtn).toBeInTheDocument();
		await dismissAllBtn.click();
		expect(dismissAll).toHaveBeenCalled();
	});

	it('forwards a per-row dismiss to the store', async () => {
		store.entries = [makeActivity('a1')];
		const screen = render(Page);
		const dismissBtn = screen.getByRole('button', { name: 'Dismiss notification' });
		await expect.element(dismissBtn).toBeInTheDocument();
		await dismissBtn.click();
		expect(dismiss).toHaveBeenCalledWith('a1');
	});

	it('navigates via goto when a notification row is clicked', async () => {
		store.entries = [makeActivity('a1')];
		const screen = render(Page);
		await screen.getByText('Alice added a1').click();
		expect(goto).toHaveBeenCalledTimes(1);
		expect(goto.mock.calls[0][0]).toMatch(/^\/libraries\/lib1/);
	});

	it('shows a Load older button and calls loadMore when there is a next cursor', async () => {
		store.entries = [makeActivity('a1')];
		store.nextCursor = 'cursor-2';
		const screen = render(Page);
		const loadOlder = screen.getByRole('button', { name: 'Load older' });
		await expect.element(loadOlder).toBeInTheDocument();
		await loadOlder.click();
		expect(loadMore).toHaveBeenCalled();
	});

	it('does not show Load older when there is no next cursor', async () => {
		store.entries = [makeActivity('a1')];
		store.nextCursor = null;
		const screen = render(Page);
		const buttons = Array.from(screen.container.querySelectorAll('button'));
		expect(buttons.some((b) => b.textContent?.includes('Load older'))).toBe(false);
	});
});
