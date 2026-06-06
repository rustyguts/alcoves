import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Activity } from '$lib/types/api';

// Mutable mock state shared with the mocked virtual modules.
const mocks = vi.hoisted(() => ({
	browser: true,
	env: {} as Record<string, string | undefined>,
	refreshUnreadCount: vi.fn(() => Promise.resolve())
}));

vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	}
}));
vi.mock('$env/dynamic/public', () => ({ env: mocks.env }));
vi.mock('$lib/state/notifications.svelte', () => ({
	notifications: {
		refreshUnreadCount: mocks.refreshUnreadCount
	}
}));

import { notificationsSocket } from './notifications-socket.svelte';

class FakeWebSocket {
	static OPEN = 1;
	static CLOSED = 3;
	static instances: FakeWebSocket[] = [];
	static last(): FakeWebSocket {
		return FakeWebSocket.instances.at(-1)!;
	}
	url: string;
	readyState = 0;
	sent: string[] = [];
	private listeners: Record<string, Array<(ev?: unknown) => void>> = {};
	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}
	addEventListener(type: string, cb: (ev?: unknown) => void) {
		(this.listeners[type] ??= []).push(cb);
	}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.readyState = FakeWebSocket.CLOSED;
		this.emit('close');
	}
	emit(type: string, ev?: unknown) {
		(this.listeners[type] ?? []).forEach((cb) => cb(ev));
	}
	doOpen() {
		this.readyState = FakeWebSocket.OPEN;
		this.emit('open');
	}
	doMessage(data: unknown) {
		this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
	}
}

const activity = (id: string): Activity =>
	({
		id,
		libraryId: 'lib1',
		actor: { id: 'u', displayName: 'A', avatarUrl: null },
		action: 'file.created',
		subjectType: 'file',
		subjectId: 'f',
		metadata: {},
		createdAt: '',
		dismissed: false
	}) as Activity;

beforeEach(() => {
	vi.useFakeTimers();
	mocks.browser = true;
	mocks.env.PUBLIC_API_ORIGIN = undefined;
	mocks.refreshUnreadCount.mockClear();
	FakeWebSocket.instances = [];
	vi.stubGlobal('WebSocket', FakeWebSocket);
	vi.stubGlobal('performance', { now: () => Date.now() });
	vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:3000' } });
	notificationsSocket.reset();
});

afterEach(() => {
	notificationsSocket.disconnect();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('notificationsSocket', () => {
	it('connects, marks connected on open, and refreshes the unread count', () => {
		notificationsSocket.connect();
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(FakeWebSocket.last().url).toContain('/api/ws');

		FakeWebSocket.last().doOpen();
		expect(notificationsSocket.connected).toBe(true);
		expect(mocks.refreshUnreadCount).toHaveBeenCalled();
	});

	it('builds a same-origin ws URL from window.location', () => {
		notificationsSocket.connect();
		expect(FakeWebSocket.last().url).toBe('ws://localhost:3000/api/ws');
	});

	it('uses wss when the page is served over https', () => {
		vi.stubGlobal('window', { location: { protocol: 'https:', host: 'app.example.com' } });
		notificationsSocket.connect();
		expect(FakeWebSocket.last().url).toBe('wss://app.example.com/api/ws');
	});

	it('prefers PUBLIC_API_ORIGIN host for the ws URL when set', () => {
		mocks.env.PUBLIC_API_ORIGIN = 'https://api.example.com/';
		notificationsSocket.connect();
		expect(FakeWebSocket.last().url).toBe('wss://api.example.com/api/ws');
	});

	it('does not connect on the server (browser=false)', () => {
		mocks.browser = false;
		notificationsSocket.connect();
		expect(FakeWebSocket.instances).toHaveLength(0);
	});

	it('re-subscribes known rooms on open', () => {
		notificationsSocket.subscribeRoom('library:1');
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		expect(FakeWebSocket.last().sent).toContainEqual(
			JSON.stringify({ type: 'subscribe', room: 'library:1' })
		);
	});

	it('dispatches activity payloads to registered handlers', () => {
		const handler = vi.fn();
		notificationsSocket.onActivity(handler);
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		FakeWebSocket.last().doMessage(activity('a1'));
		expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
	});

	it('responds to ping frames with a pong', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		FakeWebSocket.last().sent.length = 0;
		FakeWebSocket.last().doMessage({ type: 'ping' });
		expect(FakeWebSocket.last().sent).toContainEqual(JSON.stringify({ type: 'pong' }));
	});

	it('ignores control frames and malformed messages', () => {
		const handler = vi.fn();
		notificationsSocket.onActivity(handler);
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		FakeWebSocket.last().doMessage({ type: 'subscribed' });
		FakeWebSocket.last().doMessage({ type: 'unsubscribed' });
		FakeWebSocket.last().doMessage({ type: 'error' });
		FakeWebSocket.last().emit('message', { data: 'not json{' });
		expect(handler).not.toHaveBeenCalled();
	});

	it('onActivity returns an unsubscribe function', () => {
		const handler = vi.fn();
		const off = notificationsSocket.onActivity(handler);
		off();
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		FakeWebSocket.last().doMessage(activity('a1'));
		expect(handler).not.toHaveBeenCalled();
	});

	it('subscribeRoom/unsubscribeRoom send frames when the socket is open', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		FakeWebSocket.last().sent.length = 0;
		notificationsSocket.subscribeRoom('library:7');
		notificationsSocket.unsubscribeRoom('library:7');
		expect(FakeWebSocket.last().sent).toEqual([
			JSON.stringify({ type: 'subscribe', room: 'library:7' }),
			JSON.stringify({ type: 'unsubscribe', room: 'library:7' })
		]);
	});

	it('does not send room frames when the socket is closed', () => {
		notificationsSocket.subscribeRoom('library:9');
		notificationsSocket.unsubscribeRoom('library:9');
		// No socket created yet → nothing sent; subscribe should still be tracked.
		expect(FakeWebSocket.instances).toHaveLength(0);
	});

	it('schedules a reconnect after the socket closes', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		FakeWebSocket.last().close();
		expect(notificationsSocket.connected).toBe(false);
		// reconnect timer fires → new socket created
		vi.advanceTimersByTime(5000);
		expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
	});

	it('does not reconnect after an explicit disconnect', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		notificationsSocket.disconnect();
		expect(notificationsSocket.connected).toBe(false);
		const count = FakeWebSocket.instances.length;
		vi.advanceTimersByTime(60_000);
		expect(FakeWebSocket.instances.length).toBe(count);
	});

	it('starts a polling fallback after repeated reconnect failures', () => {
		notificationsSocket.connect();
		// simulate 3 failed cycles: close repeatedly so the reconnect timer fires
		for (let i = 0; i < 3; i++) {
			FakeWebSocket.last().close();
			vi.advanceTimersByTime(30_000);
		}
		mocks.refreshUnreadCount.mockClear();
		vi.advanceTimersByTime(60_000);
		expect(mocks.refreshUnreadCount).toHaveBeenCalled();
	});

	it('skips reconnecting an already-open socket', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		notificationsSocket.connect();
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it('schedules a reconnect when the WebSocket constructor throws', () => {
		vi.stubGlobal(
			'WebSocket',
			class {
				static OPEN = 1;
				constructor() {
					throw new Error('boom');
				}
			}
		);
		notificationsSocket.connect();
		// No instance retained; a reconnect timer was scheduled. Restore a working
		// fake and advance to confirm it retries.
		vi.stubGlobal('WebSocket', FakeWebSocket);
		vi.advanceTimersByTime(5000);
		expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(1);
	});

	it('error event closes the socket', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		const ws = FakeWebSocket.last();
		ws.emit('error');
		expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
	});

	it('force-closes the socket when the heartbeat times out', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		const first = FakeWebSocket.last();
		// Advance well past the heartbeat timeout with no messages.
		vi.advanceTimersByTime(40_000);
		expect(first.readyState).toBe(FakeWebSocket.CLOSED);
	});

	it('does not force-close while messages keep arriving', () => {
		notificationsSocket.connect();
		FakeWebSocket.last().doOpen();
		const ws = FakeWebSocket.last();
		// Keep refreshing lastMessageAt before each heartbeat check.
		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(9000);
			ws.doMessage(activity(`m${i}`));
		}
		expect(ws.readyState).toBe(FakeWebSocket.OPEN);
	});
});
