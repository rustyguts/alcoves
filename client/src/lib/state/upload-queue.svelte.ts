import * as tus from 'tus-js-client';
import { apiUrl } from '$lib/api';
import { toast } from '$lib/state/toast';
import { getMimeTypeFromFilename } from '$lib/utils/mime-icons';

export type UploadStatus = 'pending' | 'uploading' | 'error' | 'done';

export interface QueuedFile {
	id: string;
	file: File;
	libraryId: string;
	libraryName: string;
	parentFolderId: string | null;
	status: UploadStatus;
	progress: number;
	loaded: number;
	total: number;
	error?: string;
	retries: number;
	duplicateCount?: number;
	/** ms timestamp set when the upload succeeds; drives the batched cleanup sweep. */
	doneAt?: number;
}

const MAX_RETRIES = 3;
/** Simultaneous in-flight TUS uploads. */
const CONCURRENCY = 4;
/** How long a finished item lingers (green check) before being swept. */
const DONE_CLEANUP_MS = 2_000;
/** How often the batched sweep runs while finished items remain. */
const CLEANUP_INTERVAL_MS = 1_000;

const TUS_ENDPOINT = '/api/tus';

/**
 * App-wide TUS upload queue — a single module-level rune store shared by every
 * consumer (so the queue keeps uploading as the user navigates the SPA, and the
 * global progress panel reflects it everywhere).
 *
 * ## Performance model (built to stay smooth with thousands of queued files)
 *
 * The old implementation derived every summary (`activeUploads`, counts, …) by
 * `queue.filter(...)` on each read and removed finished items one-at-a-time with
 * a per-item `setTimeout(() => queue.filter(...))`. With N files that is O(N) per
 * summary read and O(N²) cleanup — the source of the multi-hundred-file freeze.
 *
 * This version keeps those costs O(1)/amortized:
 *  - **Status counters** (`counts`) are maintained incrementally on every status
 *    transition, so the panel header never scans the array.
 *  - **Finished items are swept in a single batched pass** on one shared interval
 *    instead of one timer + one filter per file.
 *  - Progress callbacks mutate only the (≤ CONCURRENCY) in-flight items in place,
 *    so Svelte's fine-grained reactivity re-renders just those rows — the queue
 *    array reference is stable during progress, so the (virtualized) list is not
 *    re-diffed on every byte.
 *  - The `queue` array is exposed as-is so the panel can virtualize over it; the
 *    legacy filtering getters (`activeUploads`/`erroredUploads`/…) are retained
 *    for compatibility but are NOT used on the hot render path.
 *
 * Per-library completion/success callbacks live in two maps registered through
 * `onLibraryUploadComplete`/`onLibraryUploadSuccess` (e.g. a library browser
 * refreshing its file list once its uploads finish).
 */

// Plain (non-reactive) bookkeeping: callback registries, live tus handles, and
// the per-item byte cursor used for speed are never read in templates/$derived.
const onCompleteCallbacks = new Map<string, () => void>();
const onSuccessCallbacks = new Map<string, () => void>();
const tusUploads = new Map<string, tus.Upload>();
// Last `bytesUploaded` reported per item, used to derive an accurate speed delta
// without double-counting (onProgress reports cumulative bytes, not increments).
const speedCursors = new Map<string, number>();

let queue = $state<QueuedFile[]>([]);
let isProcessing = $state(false);
let uploadSpeed = $state(0);
// O(1) status tally, maintained incrementally — never recomputed by scanning.
const counts = $state({ pending: 0, uploading: 0, error: 0, done: 0 });

// Monotonic per-session totals that drive the overall progress bar/count. Unlike
// `counts`, these are NOT decremented when finished items are swept out of the
// queue, so the overall percentage only moves forward during a run (it would
// otherwise jitter/regress as the batched sweep removes done items mid-upload).
// Both reset to 0 once the queue fully drains, so the next batch starts fresh.
let sessionSubmitted = $state(0);
let sessionCompleted = $state(0);

let speedBytes = 0;
let speedTimer: ReturnType<typeof setInterval> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startSpeedTracker() {
	if (speedTimer) return;
	speedBytes = 0;
	speedTimer = setInterval(() => {
		uploadSpeed = speedBytes * 2;
		speedBytes = 0;
	}, 500);
}

function stopSpeedTracker() {
	if (speedTimer) {
		clearInterval(speedTimer);
		speedTimer = null;
	}
	uploadSpeed = 0;
	speedBytes = 0;
}

/** Single source of truth for status changes — keeps `counts` in sync. */
function setStatus(item: QueuedFile, next: UploadStatus) {
	if (item.status === next) return;
	counts[item.status]--;
	counts[next]++;
	item.status = next;
}

function addFiles(
	files: File[],
	libraryId: string,
	libraryName: string,
	parentFolderId: string | null = null
) {
	const newItems: QueuedFile[] = files.map((file) => ({
		id: crypto.randomUUID(),
		file,
		libraryId,
		libraryName,
		parentFolderId,
		status: 'pending' as const,
		progress: 0,
		loaded: 0,
		total: file.size,
		retries: 0
	}));
	if (newItems.length === 0) return;
	counts.pending += newItems.length;
	sessionSubmitted += newItems.length;
	queue = [...queue, ...newItems];
	drainQueue();
}

/** Zero the session totals once the queue has fully drained, so the next run starts clean. */
function resetSessionIfEmpty() {
	if (queue.length === 0) {
		sessionSubmitted = 0;
		sessionCompleted = 0;
	}
}

function drainQueue() {
	if (!isProcessing) {
		isProcessing = true;
		startSpeedTracker();
	}

	while (counts.uploading < CONCURRENCY) {
		const next =
			queue.find((f) => f.status === 'pending') ||
			queue.find((f) => f.status === 'error' && f.retries < MAX_RETRIES);
		if (!next) break;

		setStatus(next, 'uploading');
		next.progress = 0;
		next.loaded = 0;
		startUpload(next);
	}

	if (counts.uploading === 0) {
		isProcessing = false;
		stopSpeedTracker();
	}
}

function notifyLibraryIfIdle(libraryId: string) {
	const hasInFlight = queue.some(
		(file) =>
			file.libraryId === libraryId && (file.status === 'pending' || file.status === 'uploading')
	);
	if (hasInFlight) return;

	const cb = onCompleteCallbacks.get(libraryId);
	if (cb) cb();
}

function notifyLibraryUploadSuccess(libraryId: string) {
	const cb = onSuccessCallbacks.get(libraryId);
	if (cb) cb();
}

function startUpload(item: QueuedFile): void {
	const mimeType = getMimeTypeFromFilename(item.file.name);

	const metadata: Record<string, string> = {
		libraryId: item.libraryId,
		filename: item.file.name,
		mimeType,
		lastModified: String(item.file.lastModified)
	};
	if (item.parentFolderId) {
		metadata.folderId = item.parentFolderId;
	}

	speedCursors.set(item.id, 0);

	const upload = new tus.Upload(item.file, {
		endpoint: apiUrl(TUS_ENDPOINT),
		retryDelays: [0, 1000, 3000, 5000, 10000],
		chunkSize: 50 * 1024 * 1024,
		// Drop the localStorage fingerprint once an upload succeeds so the browser's
		// tus URL storage doesn't grow without bound across many uploads.
		removeFingerprintOnSuccess: true,
		metadata,
		// Forward session cookie when streaming uploads cross-origin to the API.
		onBeforeRequest(req: tus.HttpRequest) {
			const xhr = req.getUnderlyingObject() as XMLHttpRequest | undefined;
			if (xhr && 'withCredentials' in xhr) xhr.withCredentials = true;
		},

		onShouldRetry(err) {
			const status = (err as tus.DetailedError).originalResponse?.getStatus();
			if (status === 401 || status === 403 || status === 404 || status === 413) {
				return false;
			}
			return true;
		},

		onAfterResponse(_req, res) {
			// Server signals dedup matches via X-Alcoves-Duplicate-Count on the
			// final TUS response (the one whose offset reaches Upload-Length).
			const raw = res.getHeader('X-Alcoves-Duplicate-Count');
			if (raw) {
				const parsed = Number(raw);
				if (Number.isFinite(parsed) && parsed > 0) {
					item.duplicateCount = parsed;
				}
			}
		},

		onChunkComplete(_chunkSize, bytesAccepted, bytesTotal) {
			item.loaded = bytesAccepted;
			item.total = bytesTotal;
			item.progress = Math.round((bytesAccepted / bytesTotal) * 100);
		},

		onProgress(bytesUploaded, bytesTotal) {
			// Ignore late callbacks from an upload that was cancelled/removed.
			if (tusUploads.get(item.id) !== upload) return;

			const optimistic = Math.round((bytesUploaded / bytesTotal) * 100);
			if (optimistic > item.progress) {
				item.progress = optimistic;
			}
			item.total = bytesTotal;

			// Accumulate only the *new* bytes since the last report for speed.
			const prev = speedCursors.get(item.id) ?? 0;
			const delta = bytesUploaded - prev;
			if (delta > 0) speedBytes += delta;
			speedCursors.set(item.id, bytesUploaded);
		},

		onSuccess() {
			// Ignore a success that arrives after the item was cancelled/removed.
			if (tusUploads.get(item.id) !== upload) return;

			setStatus(item, 'done');
			item.progress = 100;
			item.doneAt = Date.now();
			sessionCompleted++;
			tusUploads.delete(item.id);
			speedCursors.delete(item.id);

			if (item.duplicateCount && item.duplicateCount > 0) {
				const n = item.duplicateCount;
				toast.add({
					title: `Duplicate detected: ${item.file.name}`,
					description: `${n} existing file${n === 1 ? '' : 's'} in this library share the same content.`,
					color: 'warning'
				});
			}

			notifyLibraryUploadSuccess(item.libraryId);
			scheduleCleanup();
			finish(item);
		},

		onError(error) {
			// Ignore an error from an upload that was cancelled/removed.
			if (tusUploads.get(item.id) !== upload) return;

			setStatus(item, 'error');
			item.error = error.message || 'Upload failed';
			item.retries++;
			tusUploads.delete(item.id);
			speedCursors.delete(item.id);
			finish(item);
		}
	});

	tusUploads.set(item.id, upload);

	upload.findPreviousUploads().then((previousUploads) => {
		// `start()` runs a microtask after the handle is registered, so a cancel can
		// land in between. Bail if this handle is no longer the live one for the item
		// (removed, or superseded by a retry) — otherwise we'd spin up an orphaned,
		// untracked upload that can never be aborted and pins the File from GC.
		if (tusUploads.get(item.id) !== upload) return;
		if (previousUploads.length > 0 && previousUploads[0]) {
			upload.resumeFromPreviousUpload(previousUploads[0]);
		}
		upload.start();
	});
}

function finish(item: QueuedFile) {
	notifyLibraryIfIdle(item.libraryId);
	drainQueue();
}

/**
 * Remove finished items in a single batched pass on a shared interval. This
 * replaces the old per-item `setTimeout(() => queue.filter())`, which was O(N²)
 * over a large queue.
 */
function scheduleCleanup() {
	if (cleanupTimer) return;
	cleanupTimer = setInterval(sweepFinished, CLEANUP_INTERVAL_MS);
}

function sweepFinished() {
	const now = Date.now();
	let removed = 0;
	queue = queue.filter((f) => {
		if (f.status === 'done' && now - (f.doneAt ?? now) >= DONE_CLEANUP_MS) {
			removed++;
			return false;
		}
		return true;
	});
	if (removed > 0) counts.done -= removed;

	resetSessionIfEmpty();

	// Stop sweeping once no finished items remain awaiting cleanup.
	if (counts.done === 0 && cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
}

function retryFile(itemId: string) {
	const item = queue.find((f) => f.id === itemId);
	if (item && item.status === 'error') {
		setStatus(item, 'pending');
		item.retries = 0;
		item.error = undefined;
		drainQueue();
	}
}

function retryAll() {
	for (const item of queue) {
		if (item.status === 'error') {
			setStatus(item, 'pending');
			item.retries = 0;
			item.error = undefined;
		}
	}
	drainQueue();
}

/**
 * Cancel/remove a single item. Aborts the in-flight tus upload if any, frees its
 * concurrency slot, and pulls the next pending file forward.
 */
function removeFile(itemId: string) {
	const item = queue.find((f) => f.id === itemId);
	if (!item) return;

	const upload = tusUploads.get(itemId);
	if (upload) {
		upload.abort(false);
		tusUploads.delete(itemId);
	}
	speedCursors.delete(itemId);

	const wasInFlight = item.status === 'uploading' || item.status === 'pending';
	counts[item.status]--;
	// A removed item won't contribute to the session total any more. If it had
	// already completed, drop it from the completed tally too so the ratio holds.
	sessionSubmitted = Math.max(0, sessionSubmitted - 1);
	if (item.status === 'done') sessionCompleted = Math.max(0, sessionCompleted - 1);
	queue = queue.filter((f) => f.id !== itemId);
	resetSessionIfEmpty();

	// Removing an active item frees a slot — keep throughput up by refilling it.
	if (wasInFlight) drainQueue();
}

/** Alias for {@link removeFile} — clearer intent for an in-flight cancel. */
function cancelFile(itemId: string) {
	removeFile(itemId);
}

/**
 * Cancel every pending/in-flight upload in one batched pass (errored items are
 * left so they can still be retried or cleared). O(N), not O(N²).
 */
function cancelAll() {
	const remaining = counts.pending + counts.uploading;
	if (remaining === 0) return;

	for (const item of queue) {
		if (item.status === 'pending' || item.status === 'uploading') {
			const upload = tusUploads.get(item.id);
			if (upload) {
				upload.abort(false);
				tusUploads.delete(item.id);
			}
			speedCursors.delete(item.id);
		}
	}
	counts.pending = 0;
	counts.uploading = 0;
	sessionSubmitted = Math.max(sessionCompleted, sessionSubmitted - remaining);
	queue = queue.filter((f) => f.status !== 'pending' && f.status !== 'uploading');
	resetSessionIfEmpty();
	drainQueue();
}

function clearErrors() {
	if (counts.error === 0) return;
	sessionSubmitted = Math.max(sessionCompleted, sessionSubmitted - counts.error);
	counts.error = 0;
	queue = queue.filter((f) => f.status !== 'error');
	resetSessionIfEmpty();
}

function onLibraryUploadComplete(libraryId: string, callback: () => void) {
	onCompleteCallbacks.set(libraryId, callback);
}

function removeOnComplete(libraryId: string) {
	onCompleteCallbacks.delete(libraryId);
}

function onLibraryUploadSuccess(libraryId: string, callback: () => void) {
	onSuccessCallbacks.set(libraryId, callback);
}

function removeOnSuccess(libraryId: string) {
	onSuccessCallbacks.delete(libraryId);
}

/**
 * Reset all reactive state + registered callbacks + timers, aborting any in-flight
 * tus uploads. Used by tests and on logout / when the authed shell unmounts, so an
 * abandoned session doesn't leave orphaned uploads, timers, or File references alive.
 */
function reset() {
	stopSpeedTracker();
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
	for (const upload of tusUploads.values()) {
		// abort(true) terminates the transfer and clears its localStorage fingerprint.
		Promise.resolve(upload.abort(true)).catch(() => {});
	}
	queue = [];
	isProcessing = false;
	uploadSpeed = 0;
	counts.pending = 0;
	counts.uploading = 0;
	counts.error = 0;
	counts.done = 0;
	sessionSubmitted = 0;
	sessionCompleted = 0;
	tusUploads.clear();
	speedCursors.clear();
	onCompleteCallbacks.clear();
	onSuccessCallbacks.clear();
}

/** Global upload-queue singleton — import this everywhere (shared reactive state). */
export const uploadQueue = {
	get queue() {
		return queue;
	},
	get isProcessing() {
		return isProcessing;
	},
	get uploadSpeed() {
		return uploadSpeed;
	},
	// O(1) status tallies — prefer these over the filtering getters below.
	get pendingCount() {
		return counts.pending;
	},
	get uploadingCount() {
		return counts.uploading;
	},
	get errorCount() {
		return counts.error;
	},
	get doneCount() {
		return counts.done;
	},
	get totalCount() {
		return queue.length;
	},
	// Monotonic per-session totals for the overall progress display (don't jitter
	// when finished items are swept out of the queue mid-run).
	get submittedCount() {
		return sessionSubmitted;
	},
	get completedCount() {
		return sessionCompleted;
	},
	get overallProgress() {
		return sessionSubmitted > 0 ? Math.round((sessionCompleted / sessionSubmitted) * 100) : 0;
	},
	get activeCount() {
		return counts.uploading;
	},
	get hasActiveUploads() {
		return queue.length > 0;
	},
	get hasInFlightUploads() {
		return counts.pending > 0 || counts.uploading > 0;
	},
	// Legacy filtering getters — retained for compatibility; not on the hot path.
	get activeUploads() {
		return queue.filter((f) => f.status !== 'done');
	},
	get erroredUploads() {
		return queue.filter((f) => f.status === 'error');
	},
	get currentUpload() {
		return queue.find((f) => f.status === 'uploading');
	},
	addFiles,
	retryFile,
	retryAll,
	removeFile,
	cancelFile,
	cancelAll,
	clearErrors,
	onLibraryUploadComplete,
	removeOnComplete,
	onLibraryUploadSuccess,
	removeOnSuccess,
	reset
};
