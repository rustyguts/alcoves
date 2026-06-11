import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LibraryFile } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({ files: { audioDetect: vi.fn() } }));
vi.mock('$lib/api', () => ({ api: apiMock }));

const toastMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { createAudioDetectJob } from './audio-detect-job.svelte';

function makeFile(over: Partial<LibraryFile>): LibraryFile {
	return {
		id: 'f1',
		libraryId: 'lib1',
		parentFolderId: null,
		name: 'clip.mp4',
		mimeType: 'video/mp4',
		size: 1,
		kind: 'file',
		duration: 10,
		width: null,
		height: null,
		proxyStatus: null,
		...over
	} as LibraryFile;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createAudioDetectJob', () => {
	it('shifts the button label across idle → progress → ready → failed', () => {
		let file: LibraryFile = makeFile({ audioDetectStatus: null });
		const store = createAudioDetectJob(
			() => 'lib1',
			() => 'f1',
			() => file,
			vi.fn(),
			vi.fn(),
			vi.fn()
		);
		expect(store.button.label).toBe('Detect sounds');
		expect(store.button.color).toBe('primary');

		file = makeFile({ audioDetectStatus: 'processing', audioDetectProgress: 42 });
		expect(store.button.label).toBe('Detecting 42%');
		expect(store.button.loading).toBe(true);

		file = makeFile({ audioDetectStatus: 'processing' });
		expect(store.button.label).toBe('Detecting…');

		file = makeFile({ audioDetectStatus: 'ready' });
		expect(store.button.label).toBe('Redetect');

		file = makeFile({ audioDetectStatus: 'failed' });
		expect(store.button.label).toBe('Retry detect');
	});

	it('handles a missing file in the button (idle)', () => {
		const store = createAudioDetectJob(
			() => 'lib1',
			() => 'f1',
			() => null,
			vi.fn(),
			vi.fn(),
			vi.fn()
		);
		expect(store.button.label).toBe('Detect sounds');
	});

	it('run() queues detection, swaps the file via onUpdate, and toasts info', async () => {
		const updated = makeFile({ audioDetectStatus: 'queued' });
		apiMock.files.audioDetect.mockResolvedValue(updated);
		const onUpdate = vi.fn();
		const store = createAudioDetectJob(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ audioDetectStatus: null }),
			vi.fn(),
			vi.fn(),
			onUpdate
		);

		expect(store.detecting).toBe(false);
		const p = store.run();
		expect(store.detecting).toBe(true);
		await p;

		expect(apiMock.files.audioDetect).toHaveBeenCalledWith('lib1', 'f1');
		expect(onUpdate).toHaveBeenCalledWith(updated);
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Audio detection queued', color: 'info' });
		expect(store.detecting).toBe(false);
	});

	it('run() reads the id getters lazily', async () => {
		apiMock.files.audioDetect.mockResolvedValue(makeFile({}));
		let libraryId = 'lib1';
		let fileId = 'f1';
		const store = createAudioDetectJob(
			() => libraryId,
			() => fileId,
			() => null,
			vi.fn(),
			vi.fn(),
			vi.fn()
		);
		libraryId = 'lib2';
		fileId = 'f2';
		await store.run();
		expect(apiMock.files.audioDetect).toHaveBeenCalledWith('lib2', 'f2');
	});

	it('run() toasts an error and clears detecting on failure', async () => {
		apiMock.files.audioDetect.mockRejectedValue(new Error('nope'));
		const onUpdate = vi.fn();
		const store = createAudioDetectJob(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ audioDetectStatus: null }),
			vi.fn(),
			vi.fn(),
			onUpdate
		);

		await store.run();
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to queue audio detection',
			color: 'error'
		});
		expect(onUpdate).not.toHaveBeenCalled();
		expect(store.detecting).toBe(false);
	});

	describe('sync() (async-job polling + terminal toasts)', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('polls refreshFile while the status is in flight', () => {
			let file: LibraryFile = makeFile({ audioDetectStatus: 'processing' });
			const refreshFile = vi.fn();
			const store = createAudioDetectJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				refreshFile,
				vi.fn(),
				vi.fn()
			);

			store.sync();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).toHaveBeenCalledTimes(2); // default 2000ms interval

			file = makeFile({ audioDetectStatus: 'ready' });
			store.sync();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).toHaveBeenCalledTimes(2); // timer stopped
		});

		it('fires onReady + a success toast on a ready transition that was in flight', () => {
			let file: LibraryFile = makeFile({ audioDetectStatus: 'processing' });
			const onReady = vi.fn();
			const store = createAudioDetectJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				vi.fn(),
				onReady,
				vi.fn()
			);

			store.sync();
			file = makeFile({ audioDetectStatus: 'ready' });
			store.sync();

			expect(onReady).toHaveBeenCalledOnce();
			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Audio detection ready',
				color: 'success'
			});
		});

		it('toasts a failure with the error description on a failed transition', () => {
			let file: LibraryFile = makeFile({ audioDetectStatus: 'queued' });
			const store = createAudioDetectJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				vi.fn(),
				vi.fn(),
				vi.fn()
			);

			store.sync();
			file = makeFile({ audioDetectStatus: 'failed', audioDetectError: 'disk full' });
			store.sync();

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Audio detection failed',
				description: 'disk full',
				color: 'error'
			});
		});

		it('does not toast when the status is already terminal on first observe', () => {
			const store = createAudioDetectJob(
				() => 'lib1',
				() => 'f1',
				() => makeFile({ audioDetectStatus: 'ready' }),
				vi.fn(),
				vi.fn(),
				vi.fn()
			);
			store.sync();
			expect(toastMock.add).not.toHaveBeenCalled();
		});

		it('sync() handles a missing file (treated as null status)', () => {
			const refreshFile = vi.fn();
			const store = createAudioDetectJob(
				() => 'lib1',
				() => 'f1',
				() => null,
				refreshFile,
				vi.fn(),
				vi.fn()
			);
			store.sync();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).not.toHaveBeenCalled();
		});

		it('stop() halts polling', () => {
			const refreshFile = vi.fn();
			const store = createAudioDetectJob(
				() => 'lib1',
				() => 'f1',
				() => makeFile({ audioDetectStatus: 'processing' }),
				refreshFile,
				vi.fn(),
				vi.fn()
			);
			store.sync();
			store.stop();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).not.toHaveBeenCalled();
		});
	});
});
