import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import { createAsyncJob } from '$lib/state/async-job-status';
import { jobStatusButton } from '$lib/utils/job-status-button';
import type { LibraryFile } from '$lib/types/api';

/**
 * Triggers + tracks a file's transcription job. Surfaces a status-aware button
 * label and polls status while in flight via {@link createAsyncJob}, toasting on
 * terminal transitions.
 *
 * Ported from the Nuxt `useTranscribeJob` composable. `getLibraryId` /
 * `getFileId` / `getFile` are getters so the store tracks the reactive inputs
 * from the consuming component (the Vue version took `Ref`s); `setFile` writes
 * the file record back (the Vue version assigned `file.value`). State is exposed
 * via getters so reactivity survives the function boundary.
 *
 * The Vue composable wired `useAsyncJobStatus` internally. To stay free of
 * runes/`$effect` (so it is unit-testable in the node project), the polling
 * lifecycle is driven by `sync()`, which the consuming component calls from its
 * own `$effect` keyed on `transcribeStatus`; `stop()` is called on destroy.
 */
export function createTranscribeJob(
	getLibraryId: () => string,
	getFileId: () => string,
	getFile: () => LibraryFile | null | undefined,
	setFile: (file: LibraryFile) => void,
	refreshFile: () => void | Promise<void>
) {
	let running = $state(false);

	const button = $derived(
		jobStatusButton(getFile()?.transcribeStatus ?? null, getFile()?.transcribeProgress ?? null, {
			idle: 'Transcribe',
			inFlight: 'Transcribing…',
			inFlightWithProgress: (p) => `Transcribing ${p}%`,
			failed: 'Retry transcribe',
			ready: 'Retranscribe'
		})
	);

	const job = createAsyncJob({
		pollFn: refreshFile,
		labels: { ready: 'Transcription ready', failed: 'Transcription failed' }
	});

	async function run() {
		running = true;
		try {
			const updated = await api.files.transcribe(getLibraryId(), getFileId());
			setFile(updated);
			toast.add({ title: 'Transcription queued', color: 'info' });
		} catch {
			toast.add({ title: 'Failed to queue transcription', color: 'error' });
		} finally {
			running = false;
		}
	}

	/**
	 * Mirror of the Vue `useAsyncJobStatus` watcher: starts/stops polling and
	 * fires terminal toasts based on the current `transcribeStatus`/`transcribeError`.
	 * The consuming component calls this from an `$effect` that reads the file's
	 * `transcribeStatus`.
	 */
	function sync() {
		const file = getFile();
		job.sync(file?.transcribeStatus ?? null, file?.transcribeError ?? null);
	}

	function stop() {
		job.stop();
	}

	return {
		get running() {
			return running;
		},
		get button() {
			return button;
		},
		run,
		sync,
		stop
	};
}
