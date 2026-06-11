import { api } from '$lib/api';
import type { Moment, MomentCreate, MomentPatch } from '$lib/types/api';

/**
 * Reactive moments for a given library + file.
 *
 * Ported from the Nuxt `useLibraryMoments` composable. `getLibraryId` /
 * `getFileId` are getters so the store tracks the reactive ids from the
 * consuming component (the Vue version took `Ref<string>` params). State is
 * exposed via getters so reactivity survives the function boundary.
 *
 * Polling: the Vue version `watch`ed `hasInFlight` to auto start/stop a 2s
 * timer. Since runes/`$effect` are not used inside the store, the consuming
 * component drives this — call `startPolling()` when work appears (or just on
 * mount) and `stopPolling()`/`dispose()` on destroy. The timer self-stops once
 * no moment is in flight.
 */
export function createLibraryMoments(getLibraryId: () => string, getFileId: () => string) {
	let moments = $state<Moment[]>([]);
	let loading = $state(false);
	let error = $state<unknown>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	const hasInFlight = $derived(
		moments.some((m) => m.exportStatus === 'queued' || m.exportStatus === 'processing')
	);

	async function refresh() {
		const libraryId = getLibraryId();
		const fileId = getFileId();
		if (!libraryId || !fileId) return;
		loading = true;
		error = null;
		try {
			moments = (await api.moments.list(libraryId, fileId)) ?? [];
		} catch (err) {
			error = err;
		} finally {
			loading = false;
		}
	}

	async function create(body: MomentCreate): Promise<Moment> {
		const created = await api.moments.create(getLibraryId(), getFileId(), body);
		moments = [...moments, created].sort((a, b) => a.startSeconds - b.startSeconds);
		return created;
	}

	async function update(momentId: string, body: MomentPatch): Promise<Moment> {
		const updated = await api.moments.update(getLibraryId(), getFileId(), momentId, body);
		moments = moments
			.map((m) => (m.id === momentId ? updated : m))
			.sort((a, b) => a.startSeconds - b.startSeconds);
		return updated;
	}

	async function remove(momentId: string): Promise<void> {
		await api.moments.delete(getLibraryId(), getFileId(), momentId);
		moments = moments.filter((m) => m.id !== momentId);
	}

	async function syncTags(momentId: string, tagIds: string[]): Promise<Moment> {
		const updated = await api.moments.syncTags(getLibraryId(), getFileId(), momentId, tagIds);
		moments = moments.map((m) => (m.id === momentId ? updated : m));
		return updated;
	}

	async function triggerExport(momentId: string): Promise<Moment> {
		const updated = await api.moments.export(getLibraryId(), getFileId(), momentId);
		moments = moments.map((m) => (m.id === momentId ? updated : m));
		return updated;
	}

	function startPolling() {
		if (pollTimer) return;
		pollTimer = setInterval(() => {
			if (!hasInFlight) {
				stopPolling();
				return;
			}
			void refresh();
		}, 2000);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	function dispose() {
		stopPolling();
	}

	return {
		get moments() {
			return moments;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get hasInFlight() {
			return hasInFlight;
		},
		refresh,
		create,
		update,
		remove,
		syncTags,
		triggerExport,
		startPolling,
		stopPolling,
		dispose
	};
}
