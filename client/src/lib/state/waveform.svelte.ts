import { api } from '$lib/api';
import type { LibraryFile, WaveformData } from '$lib/types/api';

/**
 * Loads waveform peak data for a file once its `waveformStatus` is "ready".
 * Clears when the status leaves "ready" or the file changes.
 *
 * Ported from the Nuxt `useWaveform` composable. The Vue version reads `Ref`s
 * and `watch`es `waveformStatus`/`waveformedVersion` to drive `refresh()`; here
 * the reactive inputs are getter functions and the consuming component runs its
 * own `$effect` over those fields, calling `refresh()` on change. `refresh()`
 * keeps the same fetch-or-clear semantics, so an `$effect` that simply invokes
 * it reproduces the Vue behavior. State is exposed via getters so reactivity
 * survives the function boundary.
 */
export function createWaveform(
	getLibraryId: () => string,
	getFileId: () => string,
	getFile: () => LibraryFile | null | undefined
) {
	let data = $state<WaveformData | null>(null);

	const peaks = $derived(data?.peaks ?? null);
	const peaksPerSecond = $derived(data?.peaksPerSecond ?? 50);

	async function refresh() {
		const file = getFile();
		if (!file || file.waveformStatus !== 'ready') {
			data = null;
			return;
		}
		try {
			data = await api.files.waveform(getLibraryId(), getFileId());
		} catch {
			data = null;
		}
	}

	return {
		get data() {
			return data;
		},
		get peaks() {
			return peaks;
		},
		get peaksPerSecond() {
			return peaksPerSecond;
		},
		refresh
	};
}
