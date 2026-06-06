import { api } from '$lib/api';
import type { AudioDetection } from '$lib/types/api';

/**
 * Owns the audio-detections list for a single file.
 *
 * `getLibraryId` / `getFileId` are getters so the store tracks the reactive ids
 * from the consuming component (the Vue version took `Ref<string>` params). State
 * is exposed via getters so reactivity survives the function boundary.
 *
 * The Vue composable used `watch(() => file.value?.id, …, { immediate: true })`
 * to auto-refresh whenever the file id changed. To stay free of runes/`$effect`
 * (so it is unit-testable in the node project), that wiring lives in the
 * consuming component, which calls `refresh()` from its own `$effect` keyed on
 * the file id, or `load(libraryId, fileId)` to point the store at a new file and
 * refresh in one call. Both swallow API errors and reset the list to `[]`.
 */
export function createAudioDetections(getLibraryId: () => string, getFileId: () => string) {
	let detections = $state<AudioDetection[]>([]);

	async function fetchInto(libraryId: string, fileId: string) {
		try {
			const list = await api.files.audioDetections(libraryId, fileId);
			detections = list ?? [];
		} catch {
			detections = [];
		}
	}

	async function refresh() {
		await fetchInto(getLibraryId(), getFileId());
	}

	async function load(libraryId: string, fileId: string) {
		await fetchInto(libraryId, fileId);
	}

	return {
		get detections() {
			return detections;
		},
		refresh,
		load
	};
}
