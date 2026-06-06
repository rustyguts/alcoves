import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import { createAsyncJob } from '$lib/state/async-job-status';
import { jobStatusButton } from '$lib/utils/job-status-button';
import type { LibraryFile } from '$lib/types/api';

/**
 * Triggers + tracks a file's waveform-generation job. Polls status while in
 * flight and surfaces toasts on terminal transitions. Provides a button
 * label/spec mirroring the transcribe-job pattern.
 *
 * Reactive inputs are passed as getters so reactivity survives the function
 * boundary. The consuming component owns the lifecycle: call `sync()` from an
 * `$effect` whenever the file's waveform status changes, and `stop()` on
 * destroy. No `$effect`/`watch` lives inside the store so it stays testable in
 * the node project.
 */
export function createWaveformJob(
	getLibraryId: () => string,
	getFileId: () => string,
	getFile: () => LibraryFile | null | undefined,
	setFile: (file: LibraryFile) => void,
	refreshFile: () => void | Promise<void>
) {
	let generating = $state(false);

	const job = createAsyncJob({
		pollFn: refreshFile,
		labels: { ready: 'Waveform ready', failed: 'Waveform failed' }
	});

	const button = $derived(
		jobStatusButton(getFile()?.waveformStatus ?? null, getFile()?.waveformProgress ?? null, {
			idle: 'Generate waveform',
			inFlight: 'Generating waveform…',
			inFlightWithProgress: (p) => `Waveform ${p}%`,
			failed: 'Retry waveform',
			ready: 'Regenerate waveform'
		})
	);

	/** Drive the async-job lifecycle from the current file status. */
	function sync() {
		const file = getFile();
		job.sync(file?.waveformStatus ?? null, file?.waveformError ?? null);
	}

	async function run() {
		generating = true;
		try {
			const updated = await api.files.generateWaveform(getLibraryId(), getFileId());
			setFile(updated);
			toast.add({ title: 'Waveform queued', color: 'info' });
		} catch {
			toast.add({ title: 'Failed to queue waveform', color: 'error' });
		} finally {
			generating = false;
		}
	}

	return {
		get generating() {
			return generating;
		},
		get button() {
			return button;
		},
		sync,
		stop: job.stop,
		run
	};
}
