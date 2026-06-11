import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LibraryFile } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	files: {
		generateWaveform: vi.fn()
	}
}));
const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { createWaveformJob } from './waveform-job.svelte';

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
		sourceFileId: null,
		originalCreatedAt: null,
		hash: null,
		trashedAt: null,
		createdAt: '',
		updatedAt: '',
		owner: null,
		tags: [],
		...over
	} as LibraryFile;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createWaveformJob', () => {
	it('button label shifts with status: idle → in-flight → ready → failed', () => {
		let file = makeFile({ waveformStatus: null });
		const job = createWaveformJob(
			() => 'lib1',
			() => 'f1',
			() => file,
			(f) => (file = f),
			vi.fn()
		);

		expect(job.button.label).toBe('Generate waveform');
		expect(job.button.disabled).toBe(false);

		file = makeFile({ waveformStatus: 'processing', waveformProgress: 42 });
		expect(job.button.label).toMatch(/42/);
		expect(job.button.loading).toBe(true);

		file = makeFile({ waveformStatus: 'ready', waveformProgress: 100 });
		expect(job.button.label).toBe('Regenerate waveform');

		file = makeFile({ waveformStatus: 'failed' });
		expect(job.button.label).toBe('Retry waveform');
	});

	it('run() calls API, replaces file with response, toasts info', async () => {
		const updated = makeFile({ waveformStatus: 'queued' });
		apiMock.files.generateWaveform.mockResolvedValue(updated);

		let file = makeFile({ waveformStatus: null });
		const job = createWaveformJob(
			() => 'lib1',
			() => 'f1',
			() => file,
			(f) => (file = f),
			vi.fn()
		);

		expect(job.generating).toBe(false);
		const promise = job.run();
		expect(job.generating).toBe(true);
		await promise;

		expect(apiMock.files.generateWaveform).toHaveBeenCalledWith('lib1', 'f1');
		expect(file).toStrictEqual(updated);
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Waveform queued', color: 'info' });
		expect(job.generating).toBe(false);
	});

	it('run() reads the latest reactive ids via the getters', async () => {
		apiMock.files.generateWaveform.mockResolvedValue(makeFile({}));
		let libraryId = 'libA';
		let fileId = 'fA';
		let file: LibraryFile | null = makeFile({});
		const job = createWaveformJob(
			() => libraryId,
			() => fileId,
			() => file,
			(f) => (file = f),
			vi.fn()
		);

		libraryId = 'libB';
		fileId = 'fB';
		await job.run();
		expect(apiMock.files.generateWaveform).toHaveBeenCalledWith('libB', 'fB');
	});

	it('run() surfaces error toast and clears generating on failure', async () => {
		apiMock.files.generateWaveform.mockRejectedValue(new Error('bad'));

		let file: LibraryFile | null = makeFile({ waveformStatus: null });
		const job = createWaveformJob(
			() => 'lib1',
			() => 'f1',
			() => file,
			(f) => (file = f),
			vi.fn()
		);

		await job.run();
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to queue waveform',
			color: 'error'
		});
		expect(job.generating).toBe(false);
		// file is left untouched on failure
		expect(file?.waveformStatus).toBe(null);
	});

	describe('sync() lifecycle', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => vi.useRealTimers());

		it('polls refreshFile while the job is in flight', () => {
			const refreshFile = vi.fn();
			let file = makeFile({ waveformStatus: 'processing' });
			const job = createWaveformJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				(f) => (file = f),
				refreshFile
			);

			job.sync();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).toHaveBeenCalledTimes(2);
		});

		it('stops polling and toasts success on a ready transition that was in flight', () => {
			let file = makeFile({ waveformStatus: 'queued' });
			const refreshFile = vi.fn();
			const job = createWaveformJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				(f) => (file = f),
				refreshFile
			);

			job.sync();
			file = makeFile({ waveformStatus: 'ready' });
			job.sync();

			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Waveform ready', color: 'success' });
			refreshFile.mockClear();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).not.toHaveBeenCalled();
		});

		it('toasts failure with the waveform error on a failed transition', () => {
			let file = makeFile({ waveformStatus: 'processing' });
			const job = createWaveformJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				(f) => (file = f),
				vi.fn()
			);

			job.sync();
			file = makeFile({ waveformStatus: 'failed', waveformError: 'disk full' });
			job.sync();

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Waveform failed',
				description: 'disk full',
				color: 'error'
			});
		});

		it('does not toast when the status is already terminal on first sync', () => {
			let file = makeFile({ waveformStatus: 'ready' });
			const job = createWaveformJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				(f) => (file = f),
				vi.fn()
			);

			job.sync();
			expect(toastMock.add).not.toHaveBeenCalled();
		});

		it('stop() clears the poll timer', () => {
			const refreshFile = vi.fn();
			let file = makeFile({ waveformStatus: 'processing' });
			const job = createWaveformJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				(f) => (file = f),
				refreshFile
			);

			job.sync();
			job.stop();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).not.toHaveBeenCalled();
		});
	});
});
