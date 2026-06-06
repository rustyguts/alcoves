import { makeApiFetch } from '$lib/api/fetch';
import type { Activity, NotificationsResponse, UnreadCountResponse } from '$lib/types/api';

/**
 * Global notification-bell store. Ported from the Nuxt `useNotifications`
 * composable, which used `useState` to share one reactive instance between the
 * bell badge and the /notifications page across navigations. Here that global is
 * a single module-level rune store exported as `notifications`, so every consumer
 * imports the same instance.
 *
 * The global notification endpoints (`/api/notifications*`) are intentionally NOT
 * part of the typed `$lib/api` client (which is scoped to library resources), so
 * this store talks to them through its own `makeApiFetch`-bound `apiFetch`,
 * mirroring the Vue version's use of the raw `apiFetch`.
 *
 * No `$effect`/`watch`/polling lives here — `refreshUnreadCount` is exposed as a
 * plain method the consuming component drives from its own poll timer / socket.
 */
const apiFetch = makeApiFetch((input, init) => fetch(input, init));

class NotificationsStore {
	entries = $state<Activity[]>([]);
	unreadCount = $state(0);
	nextCursor = $state<string | null>(null);
	loading = $state(false);
	loadingMore = $state(false);
	error = $state<string | null>(null);

	private fetchPage(cursor?: string) {
		const query: Record<string, string> = {};
		if (cursor) query.cursor = cursor;
		return apiFetch<NotificationsResponse>('/api/notifications', { query });
	}

	async loadFirst() {
		this.loading = true;
		this.error = null;
		try {
			const resp = await this.fetchPage();
			this.entries = resp.entries;
			this.nextCursor = resp.nextCursor;
			this.unreadCount = resp.unreadCount;
		} catch (e) {
			this.error = (e as Error).message;
		} finally {
			this.loading = false;
		}
	}

	async loadMore() {
		if (!this.nextCursor || this.loadingMore) return;
		this.loadingMore = true;
		try {
			const resp = await this.fetchPage(this.nextCursor);
			this.entries = this.entries.concat(resp.entries);
			this.nextCursor = resp.nextCursor;
			this.unreadCount = resp.unreadCount;
		} catch (e) {
			this.error = (e as Error).message;
		} finally {
			this.loadingMore = false;
		}
	}

	async refreshUnreadCount() {
		try {
			const resp = await apiFetch<UnreadCountResponse>('/api/notifications/unread-count');
			this.unreadCount = resp.unreadCount;
		} catch {
			// ignore — polling fallback can fail transiently
		}
	}

	async dismiss(activityId: string) {
		// Optimistic: remove locally, decrement count, then call the API.
		const idx = this.entries.findIndex((a) => a.id === activityId);
		if (idx >= 0) {
			this.entries = this.entries.filter((_, i) => i !== idx);
		}
		if (this.unreadCount > 0) this.unreadCount = this.unreadCount - 1;
		try {
			await apiFetch<void>(`/api/notifications/${activityId}/dismiss`, { method: 'POST' });
		} catch (e) {
			this.error = (e as Error).message;
		}
	}

	async dismissAll() {
		this.entries = [];
		this.unreadCount = 0;
		try {
			await apiFetch<void>('/api/notifications/dismiss-all', { method: 'POST' });
		} catch (e) {
			this.error = (e as Error).message;
		}
	}

	prependLive(activity: Activity) {
		if (this.entries.some((a) => a.id === activity.id)) return;
		this.entries = [activity, ...this.entries];
		this.unreadCount = this.unreadCount + 1;
	}

	/** Reset state — primarily for tests and on logout. */
	reset() {
		this.entries = [];
		this.unreadCount = 0;
		this.nextCursor = null;
		this.loading = false;
		this.loadingMore = false;
		this.error = null;
	}
}

/** Global bell singleton — import this everywhere (shared reactive state). */
export const notifications = new NotificationsStore();
