import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import { createAsyncJob } from '$lib/state/async-job-status';
import { jobStatusButton, type JobStatusButton } from '$lib/utils/job-status-button';
import type { LibraryFile } from '$lib/types/api';

/**
 * Triggers + tracks a file's audio-event detection job. Polls status while in
 * flight, surfaces toasts on terminal transitions, and refreshes the detections
 * list when the job becomes ready.
 *
 * Ported from the Nuxt `useAudioDetectJob` composable. `getLibraryId` /
 * `getFileId` / `getFile` are getters so the store tracks reactive inputs from
 * the consuming component (the Vue version took `Ref`s). State is exposed via
 * getters so reactivity survives the function boundary.
 *
 * The Vue version composed `useAsyncJobStatus`, which internally `watch`ed the
 * status and polled. To stay free of runes/`$effect` (so it is unit-testable in
 * the node project), the polling lives in `createAsyncJob` and the consuming
 * component drives it: call `sync()` from an `$effect` keyed on the file's
 * `audioDetectStatus`, and `stop()` on destroy. `run()` swaps the file via the
 * `onUpdate` callback (the Vue version reassigned `file.value` directly).
 */
export function createAudioDetectJob(
	getLibraryId: () => string,
	getFileId: () => string,
	getFile: () => LibraryFile | null | undefined,
	refreshFile: () => Promise<void> | void,
	onReady: () => Promise<void> | void,
	onUpdate: (file: LibraryFile) => void
) {
	let detecting = $state(false);

	const job = createAsyncJob({
		pollFn: refreshFile,
		onReady,
		labels: { ready: 'Audio detection ready', failed: 'Audio detection failed' }
	});

	const button = $derived<JobStatusButton>(
		jobStatusButton(getFile()?.audioDetectStatus ?? null, getFile()?.audioDetectProgress ?? null, {
			idle: 'Detect sounds',
			inFlight: 'Detecting…',
			inFlightWithProgress: (p) => `Detecting ${p}%`,
			failed: 'Retry detect',
			ready: 'Redetect'
		})
	);

	/**
	 * Mirror of the Vue async-job watcher: feed the current status/error into the
	 * poller so it starts/stops the timer and toasts on terminal transitions. The
	 * consuming component calls this from an `$effect` that reads the file's
	 * `audioDetectStatus`.
	 */
	function sync() {
		const file = getFile();
		job.sync(file?.audioDetectStatus ?? null, file?.audioDetectError ?? null);
	}

	async function run() {
		detecting = true;
		try {
			const updated = await api.files.audioDetect(getLibraryId(), getFileId());
			onUpdate(updated);
			toast.add({ title: 'Audio detection queued', color: 'info' });
		} catch {
			toast.add({ title: 'Failed to queue audio detection', color: 'error' });
		} finally {
			detecting = false;
		}
	}

	return {
		get detecting() {
			return detecting;
		},
		get button() {
			return button;
		},
		sync,
		stop: job.stop,
		run
	};
}
