import { api } from '$lib/api';
import type { Activity, LibraryFeedResponse } from '$lib/types/api';

/**
 * Per-library activity feed rune store. Loads `/api/libraries/:id/feed`
 * paginated by an opaque cursor and exposes a `prependLive` method for rows
 * pushed over the notifications WebSocket.
 *
 * `getLibraryId` is a getter so the store tracks a reactive library id from the
 * consuming component (the Vue version took a `Ref<string> | string`). State is
 * exposed via getters so reactivity survives the function boundary; the
 * component calls `loadFirst()` from its own `onMount`/`$effect`.
 *
 * The WebSocket connection itself is wired by the component (via the shared
 * notifications socket), which calls `prependLive(activity)` for each live row —
 * this store owns no socket and no `$effect`, keeping it unit-testable.
 */
export function createLibraryFeed(getLibraryId: () => string) {
	let entries = $state<Activity[]>([]);
	let nextCursor = $state<string | null>(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);

	async function fetchPage(cursor?: string): Promise<LibraryFeedResponse> {
		return await api.libraries.feed(getLibraryId(), cursor ? { cursor } : {});
	}

	async function loadFirst() {
		loading = true;
		error = null;
		try {
			const resp = await fetchPage();
			entries = resp.entries;
			nextCursor = resp.nextCursor;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const resp = await fetchPage(nextCursor);
			entries = entries.concat(resp.entries);
			nextCursor = resp.nextCursor;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loadingMore = false;
		}
	}

	// Insert a live-pushed activity at the top of the list, deduping by id.
	function prependLive(activity: Activity) {
		if (entries.some((a) => a.id === activity.id)) return;
		entries = [activity, ...entries];
	}

	return {
		get entries() {
			return entries;
		},
		get nextCursor() {
			return nextCursor;
		},
		get loading() {
			return loading;
		},
		get loadingMore() {
			return loadingMore;
		},
		get error() {
			return error;
		},
		loadFirst,
		loadMore,
		prependLive
	};
}
