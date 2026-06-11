import { toast } from './toast';
import type { JobStatus } from '$lib/utils/job-status-button';

export interface AsyncJobOptions {
	/** Called on each poll tick while the job is in flight. */
	pollFn: () => void | Promise<void>;
	/** Called once when the job transitions to (or is observed) ready. */
	onReady?: () => void | Promise<void>;
	labels: { ready: string; failed: string };
	intervalMs?: number;
}

/**
 * Drives a backend async job's lifecycle without owning the status: the caller
 * holds the reactive status (usually a field on a file record) and calls
 * `sync(status, error)` from an `$effect` whenever it changes. `sync` starts/stops
 * the poll timer and fires a toast on a terminal transition (ready/failed), but
 * only when the job was previously in flight — so a status that is already
 * terminal on first load does not toast.
 *
 * Kept free of runes/`$effect` so it is unit-testable in the node project with
 * fake timers; the consuming component wires the `$effect` and `stop` on destroy.
 */
export function createAsyncJob(opts: AsyncJobOptions) {
	const interval = opts.intervalMs ?? 2000;
	let timer: ReturnType<typeof setInterval> | null = null;
	let prev: JobStatus = null;

	function stop() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	function start() {
		if (timer) return;
		timer = setInterval(() => void opts.pollFn(), interval);
	}

	function sync(status: JobStatus, errorMsg?: string | null) {
		const wasInFlight = prev === 'queued' || prev === 'processing';

		if (status === 'queued' || status === 'processing') {
			start();
			prev = status;
			return;
		}

		stop();
		if (status === 'ready') void opts.onReady?.();

		// Suppress the toast when the status was already terminal on first observe.
		if (wasInFlight) {
			if (status === 'ready') {
				toast.add({ title: opts.labels.ready, color: 'success' });
			} else if (status === 'failed') {
				toast.add({
					title: opts.labels.failed,
					description: errorMsg ?? undefined,
					color: 'error'
				});
			}
		}
		prev = status;
	}

	return { start, stop, sync };
}
