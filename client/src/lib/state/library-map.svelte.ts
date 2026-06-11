import { api } from '$lib/api';
import type { MapPoint } from '$lib/types/api';

/**
 * Map rune store. Loads all geotagged files for a library in one shot via
 * `/api/libraries/:id/map`. `truncated` is true when the server-side point cap
 * was hit.
 *
 * Ported from the Nuxt `useLibraryMap` composable. The Vue version took the
 * libraryId as a reactive ref read inside `load()`; here the consuming component
 * passes the current id explicitly to `load(libraryId)`.
 */
export function createLibraryMap() {
	let points = $state<MapPoint[]>([]);
	let truncated = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function load(libraryId: string) {
		loading = true;
		error = null;
		try {
			const resp = await api.libraries.map(libraryId);
			points = resp.points;
			truncated = resp.truncated;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	return {
		get points() {
			return points;
		},
		get truncated() {
			return truncated;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		load
	};
}

export type LibraryMapStore = ReturnType<typeof createLibraryMap>;
