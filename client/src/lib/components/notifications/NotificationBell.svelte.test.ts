import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Activity } from '$lib/types/api';

// Navigation is pulled in transitively by the real NotificationDropdown rendered
// inside the open popover — stub it so clicks don't try to route.
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

// Mock both global rune stores the bell drives. `vi.hoisted` exposes the shared
// handles to the hoisted `vi.mock` factories; the test mutates `noti.unreadCount`
// before each render and asserts against the spy methods.
const { noti, socket, refreshUnreadCount, prependLive, connect, onActivity } = vi.hoisted(() => {
	const refreshUnreadCount = vi.fn(() => Promise.resolve());
	const prependLive = vi.fn();
	const connect = vi.fn();
	const onActivity = vi.fn();
	return {
		refreshUnreadCount,
		prependLive,
		connect,
		onActivity,
		noti: {
			entries: [] as Activity[],
			unreadCount: 0,
			nextCursor: null as string | null,
			loading: false,
			loadFirst: vi.fn(() => Promise.resolve()),
			refreshUnreadCount,
			prependLive,
			dismiss: vi.fn(),
			dismissAll: vi.fn(() => Promise.resolve())
		},
		socket: {
			connect,
			onActivity
		}
	};
});

vi.mock('$lib/state/notifications.svelte', () => ({
	notifications: noti
}));
vi.mock('$lib/state/notifications-socket.svelte', () => ({
	notificationsSocket: socket
}));

import NotificationBell from './NotificationBell.svelte';

beforeEach(() => {
	noti.entries = [];
	noti.unreadCount = 0;
	noti.nextCursor = null;
	noti.loading = false;
	refreshUnreadCount.mockClear();
	prependLive.mockClear();
	connect.mockClear();
	onActivity.mockClear();
});

function bellButton(screen: ReturnType<typeof render>): HTMLButtonElement {
	const btn = screen.container.querySelector(
		'button[aria-label="Notifications"]'
	) as HTMLButtonElement;
	expect(btn).not.toBeNull();
	return btn;
}

describe('NotificationBell', () => {
	it('renders a bell trigger button with the bell icon', async () => {
		const screen = render(NotificationBell);
		const btn = bellButton(screen);
		expect(btn.querySelector('svg')).not.toBeNull();
	});

	it('connects the socket, registers an activity handler, and refreshes the unread count on mount', () => {
		render(NotificationBell);
		expect(connect).toHaveBeenCalled();
		expect(onActivity).toHaveBeenCalled();
		expect(refreshUnreadCount).toHaveBeenCalled();
	});

	it('hides the badge when unreadCount is 0', () => {
		noti.unreadCount = 0;
		const screen = render(NotificationBell);
		const btn = bellButton(screen);
		// Only the bell icon SVG, no badge span with a count.
		expect(btn.querySelector('span')).toBeNull();
	});

	it('renders the unread count when greater than 0', async () => {
		noti.unreadCount = 3;
		const screen = render(NotificationBell);
		const badge = bellButton(screen).querySelector('span')!;
		expect(badge).not.toBeNull();
		expect(badge.textContent?.trim()).toBe('3');
	});

	it('caps the badge at 99+', () => {
		noti.unreadCount = 250;
		const screen = render(NotificationBell);
		const badge = bellButton(screen).querySelector('span')!;
		expect(badge.textContent?.trim()).toBe('99+');
	});

	it('forwards new activities into the global store via the onActivity callback', () => {
		render(NotificationBell);
		const handler = onActivity.mock.calls[0][0] as (a: unknown) => void;
		const fake: Activity = {
			id: 'abc',
			libraryId: 'L',
			actor: null,
			action: 'file.created',
			subjectType: 'file',
			subjectId: null,
			metadata: {},
			createdAt: new Date().toISOString(),
			dismissed: false
		} as Activity;
		handler(fake);
		expect(prependLive).toHaveBeenCalledWith(fake);
	});

	it('ignores activity callbacks with no id', () => {
		render(NotificationBell);
		const handler = onActivity.mock.calls[0][0] as (a: unknown) => void;
		handler({});
		expect(prependLive).not.toHaveBeenCalled();
	});

	it('opens the dropdown popover when the bell is clicked', async () => {
		const screen = render(NotificationBell);
		bellButton(screen).click();
		// The dropdown header only mounts once the popover content opens.
		await expect.element(screen.getByText('Notifications')).toBeInTheDocument();
	});
});
