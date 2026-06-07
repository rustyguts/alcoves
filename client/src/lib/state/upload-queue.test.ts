import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UploadOptions, PreviousUpload, OnSuccessPayload } from 'tus-js-client';

/**
 * Mock tus.Upload so we never call real tus endpoints.
 *
 * Each constructed Upload is captured in `MockTusUpload.instances`. Tests can
 * simulate progress, success, and error by calling the corresponding option
 * callbacks stored on each instance.
 *
 * vi.hoisted() ensures the class is defined before the hoisted vi.mock() runs.
 */
const MockTusUpload = vi.hoisted(() => {
	class MockTusUpload {
		static instances: MockTusUpload[] = [];

		file: File;
		options: UploadOptions;
		url: string | null = null;
		started = false;
		aborted = false;
		resumed: PreviousUpload | null = null;
		// Lets a test inject resumable previous uploads for the next constructed Upload.
		static nextPrevious: PreviousUpload[] = [];

		constructor(file: File, options: UploadOptions) {
			this.file = file;
			this.options = options;
			MockTusUpload.instances.push(this);
			this.previous = MockTusUpload.nextPrevious;
			MockTusUpload.nextPrevious = [];
		}

		previous: PreviousUpload[];

		static reset() {
			MockTusUpload.instances = [];
			MockTusUpload.nextPrevious = [];
		}

		findPreviousUploads(): Promise<PreviousUpload[]> {
			return Promise.resolve(this.previous);
		}

		resumeFromPreviousUpload(prev: PreviousUpload) {
			this.resumed = prev;
		}

		start() {
			this.started = true;
		}

		abort() {
			this.aborted = true;
			return Promise.resolve();
		}

		triggerProgress(loaded: number, total: number) {
			this.options.onProgress?.(loaded, total);
		}

		triggerChunkComplete(chunkSize: number, bytesAccepted: number, bytesTotal: number) {
			this.options.onChunkComplete?.(chunkSize, bytesAccepted, bytesTotal);
		}

		triggerSuccess() {
			this.options.onSuccess?.({ lastResponse: null } as unknown as OnSuccessPayload);
		}

		triggerAfterResponse(headers: Record<string, string>) {
			const res = {
				getHeader: (name: string) => headers[name]
			};
			this.options.onAfterResponse?.({} as never, res as never);
		}

		triggerError(message = 'Upload failed') {
			const err = new Error(message);
			err.name = 'DetailedError';
			this.options.onError?.(err);
		}
	}
	return MockTusUpload;
});

vi.mock('tus-js-client', () => ({
	Upload: MockTusUpload
}));

vi.mock('$lib/api', () => ({
	apiUrl: (path: string) => path
}));

const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn()
}));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { uploadQueue, type QueuedFile } from './upload-queue.svelte';

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function queued(
	over: Partial<QueuedFile> & { id: string; status: QueuedFile['status'] }
): QueuedFile {
	return {
		file: new File(['x'], 'f'),
		libraryId: 'lib1',
		libraryName: 'L',
		parentFolderId: null,
		progress: 0,
		loaded: 0,
		total: 1,
		retries: 0,
		...over
	} as QueuedFile;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	MockTusUpload.reset();
	uploadQueue.reset();

	vi.stubGlobal('crypto', {
		randomUUID: vi.fn().mockImplementation(() => `id-${Math.random().toString(16).slice(2)}`)
	});
});

afterEach(() => {
	uploadQueue.reset();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('uploadQueue — upload lifecycle', () => {
	it('uploads a file successfully with tus metadata, reports progress, invokes completion callback, and cleans up', async () => {
		const onComplete = vi.fn();
		uploadQueue.onLibraryUploadComplete('lib-1', onComplete);

		const file = new File(['hello'], 'hello.txt', {
			type: 'text/plain',
			lastModified: 100
		});

		uploadQueue.addFiles([file], 'lib-1', 'Library One', 'folder-1');
		await flushPromises();

		expect(uploadQueue.queue).toHaveLength(1);
		expect(uploadQueue.currentUpload?.status).toBe('uploading');

		const tusUpload = MockTusUpload.instances[0]!;
		expect(tusUpload.started).toBe(true);

		// Verify tus metadata
		expect(tusUpload.options.metadata?.libraryId).toBe('lib-1');
		expect(tusUpload.options.metadata?.filename).toBe('hello.txt');
		expect(tusUpload.options.metadata?.mimeType).toBe('text/plain');
		expect(tusUpload.options.metadata?.folderId).toBe('folder-1');
		expect(tusUpload.options.metadata?.lastModified).toBe('100');
		expect(tusUpload.options.endpoint).toBe('/api/tus');
		expect(tusUpload.options.chunkSize).toBe(50 * 1024 * 1024);

		tusUpload.triggerProgress(700, 1000);
		expect(uploadQueue.currentUpload?.progress).toBe(70);

		tusUpload.triggerSuccess();
		await flushPromises();

		expect(uploadQueue.queue[0]?.status).toBe('done');
		expect(uploadQueue.queue[0]?.progress).toBe(100);
		expect(onComplete).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(2000);
		await flushPromises();

		expect(uploadQueue.queue).toHaveLength(0);
		expect(uploadQueue.hasInFlightUploads).toBe(false);
		expect(uploadQueue.isProcessing).toBe(false);
	});

	it('uploads multiple files concurrently (up to 4)', async () => {
		const files = Array.from({ length: 6 }, (_, i) => new File([`data${i}`], `file${i}.txt`));

		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// Should have started 4 concurrent uploads
		expect(MockTusUpload.instances).toHaveLength(4);
		expect(uploadQueue.queue.filter((f) => f.status === 'uploading')).toHaveLength(4);
		expect(uploadQueue.queue.filter((f) => f.status === 'pending')).toHaveLength(2);
		expect(uploadQueue.uploadingCount).toBe(4);
		expect(uploadQueue.pendingCount).toBe(2);

		// Complete the first upload — should start the 5th
		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();

		expect(MockTusUpload.instances).toHaveLength(5);
		expect(uploadQueue.queue.filter((f) => f.status === 'uploading')).toHaveLength(4);
		expect(uploadQueue.queue.filter((f) => f.status === 'pending')).toHaveLength(1);

		// Complete the second — should start the 6th
		MockTusUpload.instances[1]!.triggerSuccess();
		await flushPromises();

		expect(MockTusUpload.instances).toHaveLength(6);
		expect(uploadQueue.queue.filter((f) => f.status === 'pending')).toHaveLength(0);
	});

	it('retries failed uploads up to max retries and then leaves the item in error', async () => {
		const file = new File(['payload'], 'fail.bin');

		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		// First attempt fails
		MockTusUpload.instances[0]!.triggerError('Server error');
		await flushPromises();

		// Auto-retry picks it up (retries < MAX_RETRIES=3)
		expect(MockTusUpload.instances).toHaveLength(2);
		MockTusUpload.instances[1]!.triggerError('Server error');
		await flushPromises();

		expect(MockTusUpload.instances).toHaveLength(3);
		MockTusUpload.instances[2]!.triggerError('Server error');
		await flushPromises();

		// After 3 retries, stays in error state
		expect(MockTusUpload.instances).toHaveLength(3);
		expect(uploadQueue.queue).toHaveLength(1);
		expect(uploadQueue.queue[0]?.status).toBe('error');
		expect(uploadQueue.queue[0]?.retries).toBe(3);
		expect(uploadQueue.isProcessing).toBe(false);
	});

	it('handles errors and supports manual retry and remove', async () => {
		const file = new File(['payload'], 'network.txt');

		uploadQueue.addFiles([file], 'lib-2', 'Library Two');
		await flushPromises();

		// Fail 3 times
		MockTusUpload.instances[0]!.triggerError('Network error');
		await flushPromises();
		MockTusUpload.instances[1]!.triggerError('Network error');
		await flushPromises();
		MockTusUpload.instances[2]!.triggerError('Network error');
		await flushPromises();

		expect(uploadQueue.queue[0]?.status).toBe('error');
		expect(uploadQueue.queue[0]?.error).toBe('Network error');
		expect(uploadQueue.queue[0]?.retries).toBe(3);

		// Manual retry resets retries and re-queues
		const itemId = uploadQueue.queue[0]!.id;
		uploadQueue.retryFile(itemId);
		await flushPromises();

		expect(uploadQueue.queue[0]?.status).toBe('uploading');
		expect(MockTusUpload.instances).toHaveLength(4);

		// Remove while uploading — aborts the in-flight tus upload
		const inFlight = MockTusUpload.instances[3]!;
		uploadQueue.removeFile(itemId);
		expect(inFlight.aborted).toBe(true);
		expect(uploadQueue.queue).toHaveLength(0);
		expect(uploadQueue.activeUploads).toHaveLength(0);
		expect(uploadQueue.hasActiveUploads).toBe(false);
	});

	it('removeFile on an unknown id is a no-op (no abort)', () => {
		uploadQueue.removeFile('does-not-exist');
		expect(uploadQueue.queue).toHaveLength(0);
	});

	it('retryFile on a non-errored item does nothing', async () => {
		const file = new File(['x'], 'a.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const itemId = uploadQueue.queue[0]!.id;
		const before = MockTusUpload.instances.length;
		uploadQueue.retryFile(itemId); // currently "uploading", not "error"
		expect(MockTusUpload.instances.length).toBe(before);
	});

	it('does not include folderId in metadata when parentFolderId is null', async () => {
		const file = new File(['x'], 'test.txt');

		uploadQueue.addFiles([file], 'lib-1', 'Library One', null);
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		expect(tusUpload.options.metadata?.folderId).toBeUndefined();
		expect(tusUpload.options.metadata?.filename).toBe('test.txt');
	});
});

describe('uploadQueue — callbacks', () => {
	it('completion callback fires only after all uploads for a library finish', async () => {
		const onComplete = vi.fn();
		uploadQueue.onLibraryUploadComplete('lib-1', onComplete);

		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// Complete first file — callback should NOT fire yet
		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();
		expect(onComplete).not.toHaveBeenCalled();

		// Complete second file — callback should fire
		MockTusUpload.instances[1]!.triggerSuccess();
		await flushPromises();
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it('fires the per-library success callback on each successful upload', async () => {
		const onSuccess = vi.fn();
		uploadQueue.onLibraryUploadSuccess('lib-1', onSuccess);

		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();
		expect(onSuccess).toHaveBeenCalledTimes(1);

		MockTusUpload.instances[1]!.triggerSuccess();
		await flushPromises();
		expect(onSuccess).toHaveBeenCalledTimes(2);
	});

	it('registers and removes per-library complete/success callbacks', () => {
		expect(() => {
			uploadQueue.onLibraryUploadComplete('lib1', () => {});
			uploadQueue.removeOnComplete('lib1');
			uploadQueue.onLibraryUploadSuccess('lib1', () => {});
			uploadQueue.removeOnSuccess('lib1');
		}).not.toThrow();
	});

	it('removed complete callback does not fire after uploads finish', async () => {
		const onComplete = vi.fn();
		uploadQueue.onLibraryUploadComplete('lib-1', onComplete);
		uploadQueue.removeOnComplete('lib-1');

		const file = new File(['a'], 'a.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();
		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();

		expect(onComplete).not.toHaveBeenCalled();
	});
});

describe('uploadQueue — bulk operations', () => {
	it('retryAll resets all errored items and restarts processing', async () => {
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];

		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// Fail both — exhaust all retries
		for (let i = 0; i < MockTusUpload.instances.length; i++) {
			MockTusUpload.instances[i]!.triggerError('fail');
			await flushPromises();
		}

		// Keep failing retries until exhausted
		while (uploadQueue.queue.some((f) => f.status === 'uploading')) {
			for (const inst of MockTusUpload.instances) {
				if (inst.started && !inst.aborted) inst.triggerError('fail');
			}
			await flushPromises();
		}

		const errorCount = uploadQueue.queue.filter((f) => f.status === 'error').length;
		expect(errorCount).toBe(2);

		const prevCount = MockTusUpload.instances.length;
		uploadQueue.retryAll();
		await flushPromises();

		// Should have started new tus Upload instances
		expect(MockTusUpload.instances.length).toBeGreaterThan(prevCount);
		expect(uploadQueue.erroredUploads).toHaveLength(0);
	});

	it('clearErrors removes only errored items', async () => {
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];

		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// Fail, exhaust retries
		MockTusUpload.instances[0]!.triggerError('fail');
		await flushPromises();

		while (uploadQueue.queue.some((f) => f.status === 'uploading' || f.status === 'pending')) {
			for (const inst of MockTusUpload.instances) {
				if (inst.started && !inst.aborted) inst.triggerError('fail');
			}
			await flushPromises();
		}

		expect(uploadQueue.erroredUploads.length).toBeGreaterThanOrEqual(1);

		const totalBefore = uploadQueue.queue.length;
		uploadQueue.clearErrors();
		expect(uploadQueue.queue.length).toBeLessThan(totalBefore);
		expect(uploadQueue.queue.filter((f) => f.status === 'error')).toHaveLength(0);
	});
});

describe('uploadQueue — tus options', () => {
	it('configures tus-js-client with retry delays', async () => {
		const file = new File(['data'], 'test.txt');

		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		expect(tusUpload.options.retryDelays).toEqual([0, 1000, 3000, 5000, 10000]);
	});

	it('configures onShouldRetry to reject permanent HTTP errors', async () => {
		const file = new File(['data'], 'test.txt');

		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		const onShouldRetry = tusUpload.options.onShouldRetry!;

		// Permanent errors should not retry
		const make = (status: number) => ({ originalResponse: { getStatus: () => status } }) as never;
		expect(onShouldRetry(make(401), 1, tusUpload.options)).toBe(false);
		expect(onShouldRetry(make(403), 1, tusUpload.options)).toBe(false);
		expect(onShouldRetry(make(404), 1, tusUpload.options)).toBe(false);
		expect(onShouldRetry(make(413), 1, tusUpload.options)).toBe(false);

		// Transient errors should retry
		expect(onShouldRetry(make(500), 1, tusUpload.options)).toBe(true);

		// Network error (no response) should retry
		const networkErr = { originalResponse: null } as never;
		expect(onShouldRetry(networkErr, 1, tusUpload.options)).toBe(true);
	});

	it('resumes from a previous upload when one is found', async () => {
		const prev = { metadata: {}, creationTime: '' } as never as PreviousUpload;
		MockTusUpload.nextPrevious = [prev];

		const file = new File(['data'], 'resume.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		expect(tusUpload.resumed).toBe(prev);
		expect(tusUpload.started).toBe(true);
	});

	it('onBeforeRequest sets withCredentials on the underlying XHR', async () => {
		const file = new File(['data'], 'test.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		const xhr = { withCredentials: false };
		const req = { getUnderlyingObject: () => xhr } as never;
		tusUpload.options.onBeforeRequest?.(req);
		expect(xhr.withCredentials).toBe(true);
	});
});

describe('uploadQueue — progress + dedup', () => {
	it('updates progress from onChunkComplete for server-confirmed progress', async () => {
		const file = new File(['x'.repeat(100)], 'large.bin');

		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;

		// Simulate server confirming first chunk
		tusUpload.triggerChunkComplete(50, 50, 100);
		expect(uploadQueue.currentUpload?.progress).toBe(50);
		expect(uploadQueue.currentUpload?.loaded).toBe(50);

		// onProgress with higher value should update progress optimistically
		tusUpload.triggerProgress(75, 100);
		expect(uploadQueue.currentUpload?.progress).toBe(75);

		// onProgress with lower value (e.g. after retry) should NOT regress
		tusUpload.triggerProgress(50, 100);
		expect(uploadQueue.currentUpload?.progress).toBe(75);
	});

	it('tracks upload speed (bytes/s) over the 500ms sampling window', async () => {
		const file = new File(['x'.repeat(100)], 'speed.bin');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		// 1000 bytes delta within the window → speed = bytes * 2 (per-half-second → per-second)
		tusUpload.triggerProgress(1000, 5000);
		vi.advanceTimersByTime(500);
		expect(uploadQueue.uploadSpeed).toBe(2000);

		// No new bytes in the next window → speed resets to 0
		vi.advanceTimersByTime(500);
		expect(uploadQueue.uploadSpeed).toBe(0);
	});

	it('emits a duplicate-detected toast when X-Alcoves-Duplicate-Count > 0', async () => {
		const file = new File(['dup'], 'dup.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		tusUpload.triggerAfterResponse({ 'X-Alcoves-Duplicate-Count': '2' });
		tusUpload.triggerSuccess();
		await flushPromises();

		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Duplicate detected: dup.txt',
			description: '2 existing files in this library share the same content.',
			color: 'warning'
		});
	});

	it('singularizes the dedup toast for a single matching file', async () => {
		const file = new File(['dup'], 'one.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		tusUpload.triggerAfterResponse({ 'X-Alcoves-Duplicate-Count': '1' });
		tusUpload.triggerSuccess();
		await flushPromises();

		expect(toastMock.add).toHaveBeenCalledWith(
			expect.objectContaining({
				description: '1 existing file in this library share the same content.',
				color: 'warning'
			})
		);
	});

	it('does not toast when the duplicate-count header is absent or zero', async () => {
		const file = new File(['x'], 'clean.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		tusUpload.triggerAfterResponse({ 'X-Alcoves-Duplicate-Count': '0' });
		tusUpload.triggerSuccess();
		await flushPromises();

		expect(toastMock.add).not.toHaveBeenCalled();
	});

	it('ignores a non-numeric duplicate-count header', async () => {
		const file = new File(['x'], 'weird.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const tusUpload = MockTusUpload.instances[0]!;
		tusUpload.triggerAfterResponse({ 'X-Alcoves-Duplicate-Count': 'NaN' });
		tusUpload.triggerSuccess();
		await flushPromises();

		expect(toastMock.add).not.toHaveBeenCalled();
		expect(uploadQueue.queue[0]?.duplicateCount).toBeUndefined();
	});
});

describe('uploadQueue — derived getters', () => {
	it('derives active / in-flight / errored / current uploads from the queue', () => {
		uploadQueue.reset();
		// Seed via addFiles then mutate statuses through tus callbacks would be
		// indirect; instead drive the derived getters by adding files and
		// inspecting state transitions.
		const files = [
			new File(['a'], 'a.txt'),
			new File(['b'], 'b.txt'),
			new File(['c'], 'c.txt'),
			new File(['d'], 'd.txt')
		];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');

		// 3 uploading (concurrency), 1 pending
		expect(uploadQueue.hasActiveUploads).toBe(true);
		expect(uploadQueue.hasInFlightUploads).toBe(true);
		expect(uploadQueue.currentUpload?.status).toBe('uploading');
		expect(uploadQueue.activeUploads).toHaveLength(4);
		expect(uploadQueue.erroredUploads).toHaveLength(0);
	});

	it('reports no in-flight uploads when the queue is empty', () => {
		uploadQueue.reset();
		expect(uploadQueue.hasInFlightUploads).toBe(false);
		expect(uploadQueue.hasActiveUploads).toBe(false);
		expect(uploadQueue.currentUpload).toBeUndefined();
		expect(uploadQueue.activeCount).toBe(0);
		expect(uploadQueue.uploadSpeed).toBe(0);
		expect(uploadQueue.isProcessing).toBe(false);
	});

	it('tracks activeCount and isProcessing while uploads drain', async () => {
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		expect(uploadQueue.activeCount).toBe(2);
		expect(uploadQueue.isProcessing).toBe(true);

		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();
		expect(uploadQueue.activeCount).toBe(1);

		MockTusUpload.instances[1]!.triggerSuccess();
		await flushPromises();
		expect(uploadQueue.activeCount).toBe(0);
		expect(uploadQueue.isProcessing).toBe(false);
	});

	it('queued() shape helper is exercised by the QueuedFile type', () => {
		const item = queued({ id: '1', status: 'done' });
		expect(item.id).toBe('1');
		expect(item.status).toBe('done');
	});
});

describe('uploadQueue — O(1) counters', () => {
	it('keeps status counters in sync through the upload lifecycle', async () => {
		const files = Array.from({ length: 6 }, (_, i) => new File([`d${i}`], `f${i}.txt`));
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// 4 uploading (concurrency), 2 pending, 0 error/done.
		expect(uploadQueue.uploadingCount).toBe(4);
		expect(uploadQueue.pendingCount).toBe(2);
		expect(uploadQueue.errorCount).toBe(0);
		expect(uploadQueue.doneCount).toBe(0);
		expect(uploadQueue.totalCount).toBe(6);

		// One success: uploading 4→3 then drain pulls a pending up → uploading 4, done 1, pending 1.
		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();
		expect(uploadQueue.doneCount).toBe(1);
		expect(uploadQueue.uploadingCount).toBe(4);
		expect(uploadQueue.pendingCount).toBe(1);

		// Counters must always equal a fresh recompute over the queue.
		const recompute = (s: string) => uploadQueue.queue.filter((f) => f.status === s).length;
		expect(uploadQueue.uploadingCount).toBe(recompute('uploading'));
		expect(uploadQueue.pendingCount).toBe(recompute('pending'));
		expect(uploadQueue.doneCount).toBe(recompute('done'));
		expect(uploadQueue.errorCount).toBe(recompute('error'));
	});
});

describe('uploadQueue — cancel + slot refill', () => {
	it('cancelFile aborts an in-flight upload and pulls the next pending file forward', async () => {
		const files = Array.from({ length: 5 }, (_, i) => new File([`d${i}`], `f${i}.txt`));
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// 4 uploading, 1 pending.
		expect(uploadQueue.uploadingCount).toBe(4);
		expect(uploadQueue.pendingCount).toBe(1);
		const inFlight = MockTusUpload.instances[0]!;
		const cancelId = uploadQueue.queue[0]!.id;

		uploadQueue.cancelFile(cancelId);
		await flushPromises();

		// The tus upload was aborted, the item is gone, and the freed slot was refilled
		// by the previously-pending file (so a 5th tus upload started).
		expect(inFlight.aborted).toBe(true);
		expect(uploadQueue.queue.some((f) => f.id === cancelId)).toBe(false);
		expect(uploadQueue.uploadingCount).toBe(4);
		expect(uploadQueue.pendingCount).toBe(0);
		expect(MockTusUpload.instances).toHaveLength(5);
	});

	it('cancelling a pending item does not start an extra upload', async () => {
		const files = Array.from({ length: 6 }, (_, i) => new File([`d${i}`], `f${i}.txt`));
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		expect(MockTusUpload.instances).toHaveLength(4); // 4 in-flight, 2 pending
		const pendingItem = uploadQueue.queue.find((f) => f.status === 'pending')!;

		uploadQueue.cancelFile(pendingItem.id);
		await flushPromises();

		// A pending cancel frees no slot, so no new upload starts; one pending remains.
		expect(MockTusUpload.instances).toHaveLength(4);
		expect(uploadQueue.pendingCount).toBe(1);
		expect(uploadQueue.totalCount).toBe(5);
	});
});

describe('uploadQueue — batched cleanup', () => {
	it('sweeps many finished items in a single pass once they age out', async () => {
		const files = Array.from({ length: 4 }, (_, i) => new File([`d${i}`], `f${i}.txt`));
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// Complete all 4 concurrently.
		for (const inst of MockTusUpload.instances) inst.triggerSuccess();
		await flushPromises();

		expect(uploadQueue.doneCount).toBe(4);
		expect(uploadQueue.totalCount).toBe(4);

		// After the cleanup window the batched sweep removes them all and the queue empties.
		vi.advanceTimersByTime(3000);
		await flushPromises();

		expect(uploadQueue.totalCount).toBe(0);
		expect(uploadQueue.doneCount).toBe(0);
		expect(uploadQueue.hasActiveUploads).toBe(false);
	});
});

describe('uploadQueue — overall progress (monotonic)', () => {
	it('does not regress when the sweep removes done items mid-run, and resets when empty', async () => {
		const files = Array.from({ length: 4 }, (_, i) => new File([`d${i}`], `f${i}.txt`));
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		expect(uploadQueue.submittedCount).toBe(4);
		expect(uploadQueue.overallProgress).toBe(0);

		// Two of four complete → 50%.
		MockTusUpload.instances[0]!.triggerSuccess();
		MockTusUpload.instances[1]!.triggerSuccess();
		await flushPromises();
		expect(uploadQueue.completedCount).toBe(2);
		expect(uploadQueue.overallProgress).toBe(50);

		// The sweep removes the two done items, but progress must NOT drop back toward 0.
		vi.advanceTimersByTime(3000);
		await flushPromises();
		expect(uploadQueue.doneCount).toBe(0); // swept out of the queue
		expect(uploadQueue.overallProgress).toBe(50); // monotonic

		// Finish the rest → 100%, then everything sweeps and the session resets.
		MockTusUpload.instances[2]!.triggerSuccess();
		MockTusUpload.instances[3]!.triggerSuccess();
		await flushPromises();
		expect(uploadQueue.overallProgress).toBe(100);

		vi.advanceTimersByTime(3000);
		await flushPromises();
		expect(uploadQueue.totalCount).toBe(0);
		expect(uploadQueue.submittedCount).toBe(0);
		expect(uploadQueue.overallProgress).toBe(0);
	});
});

describe('uploadQueue — cancelAll', () => {
	it('aborts every pending/in-flight upload in one pass and stops processing', async () => {
		const files = Array.from({ length: 6 }, (_, i) => new File([`d${i}`], `f${i}.txt`));
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		expect(uploadQueue.uploadingCount).toBe(4);
		expect(uploadQueue.pendingCount).toBe(2);

		uploadQueue.cancelAll();
		await flushPromises();

		// All four in-flight tus uploads aborted; nothing left in the queue.
		expect(MockTusUpload.instances.every((i) => i.aborted)).toBe(true);
		expect(uploadQueue.totalCount).toBe(0);
		expect(uploadQueue.uploadingCount).toBe(0);
		expect(uploadQueue.pendingCount).toBe(0);
		expect(uploadQueue.hasInFlightUploads).toBe(false);
		expect(uploadQueue.isProcessing).toBe(false);
	});

	it('leaves errored items in place so they can still be retried', async () => {
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// Drive the second file to a terminal error (exhaust retries).
		while (uploadQueue.errorCount === 0) {
			for (const inst of MockTusUpload.instances) {
				if (inst.started && !inst.aborted) inst.triggerError('fail');
			}
			await flushPromises();
			if (MockTusUpload.instances.length > 20) break; // safety
		}
		expect(uploadQueue.errorCount).toBeGreaterThanOrEqual(1);

		uploadQueue.cancelAll();
		await flushPromises();

		// Errors remain; only pending/uploading were cancelled.
		expect(uploadQueue.errorCount).toBeGreaterThanOrEqual(1);
		expect(uploadQueue.uploadingCount).toBe(0);
		expect(uploadQueue.pendingCount).toBe(0);
		expect(uploadQueue.hasInFlightUploads).toBe(false);
	});
});

describe('uploadQueue — cancel during the findPreviousUploads window', () => {
	it('does not start an orphaned upload when cancelled before start()', async () => {
		const file = new File(['x'], 'race.txt');
		// Do NOT flush — start() runs in the findPreviousUploads().then microtask.
		uploadQueue.addFiles([file], 'lib-1', 'Library One');

		const inst = MockTusUpload.instances[0]!;
		expect(inst.started).toBe(false); // not started yet
		const id = uploadQueue.queue[0]!.id;

		uploadQueue.cancelFile(id);
		await flushPromises();

		// The deferred start was guarded out — no orphaned, untracked upload.
		expect(inst.started).toBe(false);
		expect(inst.aborted).toBe(true);
		expect(uploadQueue.uploadingCount).toBe(0);
		expect(uploadQueue.totalCount).toBe(0);
	});

	it('ignores a late onError/onSuccess from a removed item (no negative counters)', async () => {
		const file = new File(['x'], 'late.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const inst = MockTusUpload.instances[0]!;
		const id = uploadQueue.queue[0]!.id;
		uploadQueue.removeFile(id);

		// A late callback from the aborted upload must be a no-op.
		inst.triggerError('late failure');
		inst.triggerSuccess();
		await flushPromises();

		expect(uploadQueue.uploadingCount).toBe(0);
		expect(uploadQueue.errorCount).toBe(0);
		expect(uploadQueue.doneCount).toBe(0);
		expect(uploadQueue.totalCount).toBe(0);
	});
});

describe('uploadQueue — remove on terminal items + empty add', () => {
	it('removeFile on an errored item clears it without refilling a slot', async () => {
		const file = new File(['x'], 'err.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		// Exhaust retries → error.
		while (uploadQueue.errorCount === 0) {
			for (const inst of MockTusUpload.instances) {
				if (inst.started && !inst.aborted) inst.triggerError('fail');
			}
			await flushPromises();
			if (MockTusUpload.instances.length > 20) break;
		}
		const before = MockTusUpload.instances.length;
		const id = uploadQueue.queue[0]!.id;

		uploadQueue.removeFile(id);
		expect(uploadQueue.errorCount).toBe(0);
		expect(uploadQueue.totalCount).toBe(0);
		expect(MockTusUpload.instances.length).toBe(before); // no drain/refill
	});

	it('removeFile on a done item before the sweep leaves no negative count', async () => {
		const file = new File(['x'], 'ok.txt');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();
		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();

		const id = uploadQueue.queue[0]!.id;
		uploadQueue.removeFile(id);
		expect(uploadQueue.doneCount).toBe(0);
		expect(uploadQueue.totalCount).toBe(0);

		vi.advanceTimersByTime(3000);
		await flushPromises();
		expect(uploadQueue.doneCount).toBe(0); // sweep didn't double-decrement
	});

	it('addFiles with an empty array is a no-op', () => {
		uploadQueue.addFiles([], 'lib-1', 'Library One');
		expect(uploadQueue.totalCount).toBe(0);
		expect(uploadQueue.isProcessing).toBe(false);
		expect(MockTusUpload.instances).toHaveLength(0);
	});
});

describe('uploadQueue — counters cross-check & invariants', () => {
	it('all four counters equal a fresh recompute across done/error/retry/sweep', async () => {
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// One success → done.
		MockTusUpload.instances[0]!.triggerSuccess();
		await flushPromises();

		// Second → terminal error.
		while (uploadQueue.errorCount === 0) {
			for (const inst of MockTusUpload.instances) {
				if (inst.started && !inst.aborted) inst.triggerError('fail');
			}
			await flushPromises();
			if (MockTusUpload.instances.length > 20) break;
		}

		const recompute = (s: QueuedFile['status']) =>
			uploadQueue.queue.filter((f) => f.status === s).length;
		const check = () => {
			expect(uploadQueue.pendingCount).toBe(recompute('pending'));
			expect(uploadQueue.uploadingCount).toBe(recompute('uploading'));
			expect(uploadQueue.doneCount).toBe(recompute('done'));
			expect(uploadQueue.errorCount).toBe(recompute('error'));
		};
		check();

		// Manual retry: error → pending → uploading.
		uploadQueue.retryFile(uploadQueue.queue.find((f) => f.status === 'error')!.id);
		await flushPromises();
		check();

		// Sweep removes the done item.
		vi.advanceTimersByTime(3000);
		await flushPromises();
		check();
	});

	it('reports no in-flight uploads when every file has errored (beforeunload guard input)', async () => {
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		while (uploadQueue.queue.some((f) => f.status !== 'error')) {
			for (const inst of MockTusUpload.instances) {
				if (inst.started && !inst.aborted) inst.triggerError('fail');
			}
			await flushPromises();
			if (MockTusUpload.instances.length > 40) break;
		}

		expect(uploadQueue.errorCount).toBe(2);
		expect(uploadQueue.hasInFlightUploads).toBe(false); // → beforeunload would NOT block
		expect(uploadQueue.hasActiveUploads).toBe(true); // panel stays visible to show failures
	});

	it('keeps the queue array reference stable across in-place progress mutation', async () => {
		const file = new File(['x'.repeat(100)], 'stable.bin');
		uploadQueue.addFiles([file], 'lib-1', 'Library One');
		await flushPromises();

		const ref = uploadQueue.queue;
		MockTusUpload.instances[0]!.triggerProgress(700, 1000);
		expect(uploadQueue.queue).toBe(ref); // mutated in place, not reassigned
		expect(uploadQueue.currentUpload?.progress).toBe(70);

		// A structural change (adding files) DOES create a new array reference.
		uploadQueue.addFiles([new File(['y'], 'y.txt')], 'lib-1', 'Library One');
		expect(uploadQueue.queue).not.toBe(ref);
	});

	it('attributes speed across concurrent uploads without overwriting', async () => {
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		uploadQueue.addFiles(files, 'lib-1', 'Library One');
		await flushPromises();

		// Two concurrent uploads report progress within the same sampling window.
		MockTusUpload.instances[0]!.triggerProgress(600, 5000);
		MockTusUpload.instances[1]!.triggerProgress(400, 5000);
		vi.advanceTimersByTime(500);
		expect(uploadQueue.uploadSpeed).toBe((600 + 400) * 2); // summed, not last-wins
	});
});
