import * as tus from 'tus-js-client';
import { apiUrl } from '$lib/api';
import { toast } from '$lib/state/toast';
import { getMimeTypeFromFilename } from '$lib/utils/mime-icons';

export interface QueuedFile {
	id: string;
	file: File;
	libraryId: string;
	libraryName: string;
	parentFolderId: string | null;
	status: 'pending' | 'uploading' | 'error' | 'done';
	progress: number;
	loaded: number;
	total: number;
	error?: string;
	retries: number;
	duplicateCount?: number;
}

const MAX_RETRIES = 3;
const CONCURRENCY = 3;
const DONE_CLEANUP_MS = 2_000;

const TUS_ENDPOINT = '/api/tus';

/**
 * Global TUS upload queue, ported from the Nuxt `useUploadQueue` composable.
 *
 * The Vue version shared one reactive instance across the whole app via
 * module-level `ref`s plus a `useUploadQueue()` factory that closed over the
 * per-app tus-Upload map and speed tracker. Here that global is a single
 * module-level rune store exposed via getters, so every consumer imports the
 * same instance and reactivity survives the function boundary.
 *
 * No `$effect`/`watch` lives here — `addFiles`/`retryFile`/`removeFile`/etc. are
 * plain methods the consuming component calls. The internal speed tracker is a
 * `setInterval` started/stopped explicitly while uploads are draining.
 *
 * Per-library completion/success callbacks live in two maps registered through
 * `onLibraryUploadComplete`/`onLibraryUploadSuccess`, mirroring the Vue version
 * (e.g. a library browser refreshing its file list once its uploads finish).
 */

// Plain (non-reactive) bookkeeping: callback registries and live tus handles are
// never read in `$derived`/templates, so they intentionally stay as built-in Maps.

const onCompleteCallbacks = new Map<string, () => void>();
const onSuccessCallbacks = new Map<string, () => void>();
const tusUploads = new Map<string, tus.Upload>();

let queue = $state<QueuedFile[]>([]);
let isProcessing = $state(false);
let uploadSpeed = $state(0);
let activeCount = $state(0);

let speedBytes = 0;
let speedTimer: ReturnType<typeof setInterval> | null = null;

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
	queue = [...queue, ...newItems];
	drainQueue();
}

function drainQueue() {
	if (!isProcessing) {
		isProcessing = true;
		startSpeedTracker();
	}

	while (activeCount < CONCURRENCY) {
		const next =
			queue.find((f) => f.status === 'pending') ||
			queue.find((f) => f.status === 'error' && f.retries < MAX_RETRIES);
		if (!next) break;

		next.status = 'uploading';
		next.progress = 0;
		next.loaded = 0;
		activeCount++;
		uploadFile(next);
	}

	if (activeCount === 0) {
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

function uploadFile(item: QueuedFile): void {
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

	const upload = new tus.Upload(item.file, {
		endpoint: apiUrl(TUS_ENDPOINT),
		retryDelays: [0, 1000, 3000, 5000, 10000],
		chunkSize: 50 * 1024 * 1024,
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
			const optimistic = Math.round((bytesUploaded / bytesTotal) * 100);
			if (optimistic > item.progress) {
				item.progress = optimistic;
			}
			item.total = bytesTotal;

			const prevLoaded = item.loaded;
			const delta = bytesUploaded - prevLoaded;
			if (delta > 0) {
				speedBytes += delta;
			}
		},

		onSuccess() {
			item.status = 'done';
			item.progress = 100;
			tusUploads.delete(item.id);

			if (item.duplicateCount && item.duplicateCount > 0) {
				const n = item.duplicateCount;
				toast.add({
					title: `Duplicate detected: ${item.file.name}`,
					description: `${n} existing file${n === 1 ? '' : 's'} in this library share the same content.`,
					color: 'warning'
				});
			}

			notifyLibraryUploadSuccess(item.libraryId);

			setTimeout(() => {
				queue = queue.filter((f) => f.id !== item.id);
			}, DONE_CLEANUP_MS);

			finish(item);
		},

		onError(error) {
			item.status = 'error';
			item.error = error.message || 'Upload failed';
			item.retries++;
			tusUploads.delete(item.id);
			finish(item);
		}
	});

	tusUploads.set(item.id, upload);

	upload.findPreviousUploads().then((previousUploads) => {
		if (previousUploads.length > 0 && previousUploads[0]) {
			upload.resumeFromPreviousUpload(previousUploads[0]);
		}
		upload.start();
	});
}

function finish(item: QueuedFile) {
	activeCount--;
	notifyLibraryIfIdle(item.libraryId);
	drainQueue();
}

function retryFile(itemId: string) {
	const item = queue.find((f) => f.id === itemId);
	if (item && item.status === 'error') {
		item.status = 'pending';
		item.retries = 0;
		drainQueue();
	}
}

function retryAll() {
	for (const item of queue) {
		if (item.status === 'error') {
			item.status = 'pending';
			item.retries = 0;
		}
	}
	drainQueue();
}

function removeFile(itemId: string) {
	const upload = tusUploads.get(itemId);
	if (upload) {
		upload.abort(false);
		tusUploads.delete(itemId);
	}
	queue = queue.filter((f) => f.id !== itemId);
}

function clearErrors() {
	queue = queue.filter((f) => f.status !== 'error');
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
 * Reset all reactive state + registered callbacks + the speed tracker. Primarily
 * for tests; also safe to call on logout. Does not abort in-flight tus uploads.
 */
function reset() {
	stopSpeedTracker();
	queue = [];
	isProcessing = false;
	uploadSpeed = 0;
	activeCount = 0;
	tusUploads.clear();
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
	get activeCount() {
		return activeCount;
	},
	get activeUploads() {
		return queue.filter((f) => f.status !== 'done');
	},
	get hasActiveUploads() {
		return queue.filter((f) => f.status !== 'done').length > 0;
	},
	get hasInFlightUploads() {
		return queue.some((f) => f.status === 'pending' || f.status === 'uploading');
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
	clearErrors,
	onLibraryUploadComplete,
	removeOnComplete,
	onLibraryUploadSuccess,
	removeOnSuccess,
	reset
};
