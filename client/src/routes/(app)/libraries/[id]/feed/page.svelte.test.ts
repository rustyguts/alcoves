import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Activity } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1' },
		url: new URL('http://localhost/libraries/lib-1/feed'),
		data: {}
	}
}));

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => goto(...a) }));

// ─── library-feed store mock ──────────────────────────────────────────────────
// A reactive fake so the page's $derived(groups) and {#if feed.*} branches update.
const feedState = vi.hoisted(() => ({
	entries: [] as Activity[],
	nextCursor: null as string | null,
	loading: false,
	loadingMore: false,
	loadFirst: vi.fn(),
	loadMore: vi.fn(),
	prependLive: vi.fn()
}));

vi.mock('$lib/state/library-feed.svelte', () => ({
	createLibraryFeed: vi.fn(() => {
		return {
			get entries() {
				return feedState.entries;
			},
			get nextCursor() {
				return feedState.nextCursor;
			},
			get loading() {
				return feedState.loading;
			},
			get loadingMore() {
				return feedState.loadingMore;
			},
			get error() {
				return null;
			},
			loadFirst: feedState.loadFirst,
			loadMore: feedState.loadMore,
			prependLive: feedState.prependLive
		};
	})
}));

// ─── notifications-socket store mock ─────────────────────────────────────────
const socketState = vi.hoisted(() => ({
	connect: vi.fn(),
	subscribeRoom: vi.fn(),
	unsubscribeRoom: vi.fn(),
	unsubscribeFn: vi.fn(),
	handler: null as ((a: Activity) => void) | null
}));

vi.mock('$lib/state/notifications-socket.svelte', () => ({
	notificationsSocket: {
		connect: socketState.connect,
		subscribeRoom: socketState.subscribeRoom,
		unsubscribeRoom: socketState.unsubscribeRoom,
		onActivity: vi.fn((h: (a: Activity) => void) => {
			socketState.handler = h;
			return socketState.unsubscribeFn;
		})
	}
}));

import Page from './+page.svelte';

function makeActivity(id: string, over: Partial<Activity> = {}): Activity {
	return {
		id,
		libraryId: 'lib-1',
		libraryName: 'Family',
		actor: { id: 'u1', displayName: 'Alice', avatarUrl: null },
		action: 'file.created',
		subjectType: 'file',
		subjectId: 'f1',
		metadata: { name: `${id}.jpg` },
		createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
		dismissed: false,
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	feedState.entries = [];
	feedState.nextCursor = null;
	feedState.loading = false;
	feedState.loadingMore = false;
	socketState.handler = null;
});

describe('/libraries/[id]/feed', () => {
	it('renders the header', async () => {
		const screen = render(Page);
		await expect.element(screen.getByText('Activity feed')).toBeInTheDocument();
		expect(screen.container.textContent).toContain('Everything that has happened in this library');
	});

	it('shows the loading state while loading with no entries', async () => {
		feedState.loading = true;
		const screen = render(Page);
		await expect.element(screen.getByText('Loading…')).toBeInTheDocument();
	});

	it('shows the empty state when there is no activity', async () => {
		const screen = render(Page);
		await expect.element(screen.getByText('No activity yet.')).toBeInTheDocument();
	});

	it('renders grouped activity rows', async () => {
		feedState.entries = [makeActivity('a')];
		const screen = render(Page);
		await expect.element(screen.getByText('Alice added a.jpg')).toBeInTheDocument();
	});

	it('on mount loads the first page and subscribes to the library room', async () => {
		render(Page);
		await tick();
		expect(feedState.loadFirst).toHaveBeenCalled();
		expect(socketState.connect).toHaveBeenCalled();
		expect(socketState.subscribeRoom).toHaveBeenCalledWith('library:lib-1');
	});

	it('prepends a live activity for this library and ignores others', async () => {
		render(Page);
		await tick();
		expect(socketState.handler).toBeTruthy();

		// Same library → prepended.
		const mine = makeActivity('live-1');
		socketState.handler!(mine);
		expect(feedState.prependLive).toHaveBeenCalledWith(mine);

		// Different library → ignored.
		feedState.prependLive.mockClear();
		socketState.handler!(makeActivity('other', { libraryId: 'lib-2' }));
		expect(feedState.prependLive).not.toHaveBeenCalled();
	});

	it('renders a Load older button and calls loadMore when clicked', async () => {
		feedState.entries = [makeActivity('a')];
		feedState.nextCursor = 'cursor-1';
		const screen = render(Page);
		const btn = screen.getByRole('button', { name: 'Load older' });
		await expect.element(btn).toBeInTheDocument();
		await btn.click();
		expect(feedState.loadMore).toHaveBeenCalled();
	});

	it('navigates via goto when a row is clicked', async () => {
		feedState.entries = [makeActivity('a')];
		const screen = render(Page);
		await screen.getByText('Alice added a.jpg').click();
		expect(goto).toHaveBeenCalledTimes(1);
		expect(goto.mock.calls[0][0]).toMatch(/^\/libraries\/lib-1/);
	});

	it('unsubscribes from the room and removes the handler on destroy', async () => {
		const screen = render(Page);
		await tick();
		screen.unmount();
		expect(socketState.unsubscribeRoom).toHaveBeenCalledWith('library:lib-1');
		expect(socketState.unsubscribeFn).toHaveBeenCalled();
	});
});
