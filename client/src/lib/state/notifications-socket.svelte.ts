import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { notifications } from '$lib/state/notifications.svelte';
import type { Activity } from '$lib/types/api';

type ActivityHandler = (a: Activity) => void;

const MAX_RECONNECT = 30_000;
const HEARTBEAT_TIMEOUT_MS = 35_000; // ping every 25s; close after 35s of silence

/**
 * Singleton-per-app WebSocket connection to the activity feed. Auto-rejoins the
 * user's `user:{id}` room server-side on connect; `library:` rooms are
 * subscribed/unsubscribed on demand as pages mount/unmount.
 *
 * Ported from the Nuxt `useNotificationsSocket` composable (which shared one
 * instance via `useState`). Here it is a single module-level rune store
 * (`notificationsSocket`) so every consumer drives the same connection. `connected`
 * is a `$state` boolean exposed through a getter so reactivity survives the
 * module boundary. No `$effect`/lifecycle hooks live here — the consuming layout
 * calls `connect()`/`disconnect()` from `onMount`/`onDestroy`, and pages call
 * `subscribeRoom`/`unsubscribeRoom`.
 */
class NotificationsSocketStore {
	#connected = $state(false);
	#ws: WebSocket | null = null;
	#reconnectAttempt = 0;
	#closed = false;
	#pollFallback: ReturnType<typeof setInterval> | null = null;
	#heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#lastMessageAt = 0;
	#subscribedRooms = new Set<string>();
	#handlers: ActivityHandler[] = [];

	get connected() {
		return this.#connected;
	}

	#wsUrl(): string {
		if (!browser) return '';
		// Prefer the configured direct API origin (bypasses the proxy); otherwise
		// use the page's own origin — SvelteKit's /api proxy forwards to the Go API.
		const origin = (env.PUBLIC_API_ORIGIN ?? '').replace(/\/$/, '');
		if (origin) {
			const proto = origin.startsWith('https') ? 'wss:' : 'ws:';
			const host = origin.replace(/^https?:\/\//i, '');
			return `${proto}//${host}/api/ws`;
		}
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${window.location.host}/api/ws`;
	}

	#startHeartbeat() {
		if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
		this.#heartbeatTimer = setInterval(() => {
			if (!this.#ws) return;
			if (performance.now() - this.#lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
				// Force-close; onclose triggers reconnect.
				try {
					this.#ws.close();
				} catch {
					// ignore
				}
			}
		}, 10_000);
	}

	#stopHeartbeat() {
		if (this.#heartbeatTimer) {
			clearInterval(this.#heartbeatTimer);
			this.#heartbeatTimer = null;
		}
	}

	#scheduleReconnect() {
		if (this.#closed) return;
		const attempt = this.#reconnectAttempt + 1;
		this.#reconnectAttempt = attempt;
		const base = Math.min(MAX_RECONNECT, 1000 * Math.pow(2, attempt - 1));
		const delay = base * (0.75 + Math.random() * 0.5); // jitter
		// After 3 failures, poll the unread count as a fallback.
		if (attempt >= 3 && !this.#pollFallback) {
			this.#pollFallback = setInterval(() => {
				void notifications.refreshUnreadCount();
			}, 60_000);
		}
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			this.connect();
		}, delay);
	}

	#stopPollFallback() {
		if (this.#pollFallback) {
			clearInterval(this.#pollFallback);
			this.#pollFallback = null;
		}
	}

	connect() {
		if (!browser) return;
		if (this.#ws && this.#ws.readyState === WebSocket.OPEN) return;
		this.#closed = false;
		let ws: WebSocket;
		try {
			ws = new WebSocket(this.#wsUrl());
		} catch {
			this.#scheduleReconnect();
			return;
		}
		this.#ws = ws;
		ws.addEventListener('open', () => {
			this.#connected = true;
			this.#reconnectAttempt = 0;
			this.#lastMessageAt = performance.now();
			// Re-subscribe to all known library rooms.
			for (const room of this.#subscribedRooms) {
				ws.send(JSON.stringify({ type: 'subscribe', room }));
			}
			// On reconnect, recover any events dropped during the gap by refetching
			// the bell unread count.
			void notifications.refreshUnreadCount().catch(() => {});
			this.#stopPollFallback();
			this.#startHeartbeat();
		});
		ws.addEventListener('message', (ev) => {
			this.#lastMessageAt = performance.now();
			try {
				const data = JSON.parse((ev as MessageEvent).data as string);
				if (data?.type === 'ping') {
					ws.send(JSON.stringify({ type: 'pong' }));
					return;
				}
				if (
					data?.type === 'subscribed' ||
					data?.type === 'unsubscribed' ||
					data?.type === 'error'
				) {
					return;
				}
				// Otherwise it's an activity payload (no `type` field).
				const activity = data as Activity;
				for (const h of this.#handlers) h(activity);
			} catch {
				// ignore malformed frame
			}
		});
		ws.addEventListener('close', () => {
			this.#connected = false;
			this.#stopHeartbeat();
			this.#ws = null;
			this.#scheduleReconnect();
		});
		ws.addEventListener('error', () => {
			try {
				ws.close();
			} catch {
				// ignore
			}
		});
	}

	disconnect() {
		this.#closed = true;
		this.#stopHeartbeat();
		this.#stopPollFallback();
		// Cancel any pending reconnect scheduled before this teardown, so it can't
		// reopen the socket after disconnect().
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
		if (this.#ws) {
			try {
				this.#ws.close();
			} catch {
				// ignore
			}
		}
		this.#ws = null;
		this.#connected = false;
	}

	subscribeRoom(room: string) {
		this.#subscribedRooms.add(room);
		if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify({ type: 'subscribe', room }));
		}
	}

	unsubscribeRoom(room: string) {
		this.#subscribedRooms.delete(room);
		if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify({ type: 'unsubscribe', room }));
		}
	}

	onActivity(handler: ActivityHandler): () => void {
		this.#handlers.push(handler);
		return () => {
			const i = this.#handlers.indexOf(handler);
			if (i >= 0) this.#handlers.splice(i, 1);
		};
	}

	/** Reset all state — primarily for tests. */
	reset() {
		this.disconnect();
		this.#closed = false;
		this.#reconnectAttempt = 0;
		this.#lastMessageAt = 0;
		this.#subscribedRooms = new Set();
		this.#handlers = [];
	}
}

/** Global socket singleton — import this everywhere (shared connection). */
export const notificationsSocket = new NotificationsSocketStore();
