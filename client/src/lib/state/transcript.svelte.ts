import { api } from '$lib/api';
import { parseVtt, type VttCue } from '$lib/utils/parse-vtt';
import type { LibraryFile } from '$lib/types/api';

/**
 * Loads + parses the transcript VTT for a file once its `transcribeStatus`
 * goes "ready". Clears when the status leaves "ready" or the file changes.
 *
 * Ported from the Nuxt `useTranscript` composable. `getLibraryId`/`getFileId`/
 * `getFile` are getters so the store tracks reactive inputs from the consuming
 * component (the Vue version took `Ref`s). State is exposed via getters so
 * reactivity survives the function boundary. The Vue `watch(..., immediate)` on
 * `transcribeStatus` is replaced by an explicit `sync()` method the component
 * calls from its own `$effect` (which re-runs whenever the status changes).
 */
export function createTranscript(
	getLibraryId: () => string,
	getFileId: () => string,
	getFile: () => LibraryFile | null | undefined
) {
	let vtt = $state<string | null>(null);
	const cues = $derived<VttCue[]>(parseVtt(vtt));

	async function refresh() {
		const file = getFile();
		if (!file || file.transcribeStatus !== 'ready') {
			vtt = null;
			return;
		}
		try {
			const r = await api.files.transcript(getLibraryId(), getFileId());
			vtt = r?.vtt ?? null;
		} catch {
			vtt = null;
		}
	}

	/**
	 * Mirror of the Vue watcher on `transcribeStatus`: load the transcript when
	 * the status is "ready", otherwise clear it. The consuming component calls
	 * this from an `$effect` that reads `getFile()?.transcribeStatus`.
	 */
	function sync() {
		if (getFile()?.transcribeStatus === 'ready') void refresh();
		else vtt = null;
	}

	return {
		get vtt() {
			return vtt;
		},
		get cues() {
			return cues;
		},
		refresh,
		sync
	};
}
