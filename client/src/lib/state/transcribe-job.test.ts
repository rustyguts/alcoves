import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LibraryFile } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	files: {
		transcribe: vi.fn()
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

import { createTranscribeJob } from './transcribe-job.svelte';

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

describe('createTranscribeJob', () => {
	it('starts not running with the idle button label', () => {
		const file = makeFile({ transcribeStatus: null });
		const store = createTranscribeJob(
			() => 'lib1',
			() => 'f1',
			() => file,
			() => {},
			vi.fn()
		);
		expect(store.running).toBe(false);
		expect(store.button.label).toBe('Transcribe');
		expect(store.button.color).toBe('primary');
	});

	it('shifts the button label across idle → progress → in flight → ready → failed', () => {
		let file: LibraryFile = makeFile({ transcribeStatus: null });
		const store = createTranscribeJob(
			() => 'lib1',
			() => 'f1',
			() => file,
			() => {},
			vi.fn()
		);

		expect(store.button.label).toBe('Transcribe');

		file = makeFile({ transcribeStatus: 'processing', transcribeProgress: 7 });
		expect(store.button.label).toBe('Transcribing 7%');
		expect(store.button.loading).toBe(true);

		file = makeFile({ transcribeStatus: 'processing', transcribeProgress: null });
		expect(store.button.label).toBe('Transcribing…');

		file = makeFile({ transcribeStatus: 'ready' });
		expect(store.button.label).toBe('Retranscribe');

		file = makeFile({ transcribeStatus: 'failed' });
		expect(store.button.label).toBe('Retry transcribe');
	});

	it('button reads the file getter lazily and reflects the latest file', () => {
		let file: LibraryFile | null = null;
		const store = createTranscribeJob(
			() => 'lib1',
			() => 'f1',
			() => file,
			() => {},
			vi.fn()
		);
		expect(store.button.label).toBe('Transcribe');
		file = makeFile({ transcribeStatus: 'queued' });
		expect(store.button.label).toBe('Transcribing…');
	});

	it('run() queues transcription, writes the file back, and toasts info', async () => {
		const updated = makeFile({ transcribeStatus: 'queued' });
		apiMock.files.transcribe.mockResolvedValue(updated);
		const setFile = vi.fn();
		const store = createTranscribeJob(
			() => 'lib1',
			() => 'f1',
			() => null,
			setFile,
			vi.fn()
		);

		const p = store.run();
		expect(store.running).toBe(true);
		await p;

		expect(apiMock.files.transcribe).toHaveBeenCalledWith('lib1', 'f1');
		expect(setFile).toHaveBeenCalledWith(updated);
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Transcription queued', color: 'info' });
		expect(store.running).toBe(false);
	});

	it('run() reads the id getters lazily', async () => {
		let libraryId = 'libA';
		let fileId = 'fA';
		apiMock.files.transcribe.mockResolvedValue(makeFile({}));
		const store = createTranscribeJob(
			() => libraryId,
			() => fileId,
			() => null,
			() => {},
			vi.fn()
		);
		await store.run();
		expect(apiMock.files.transcribe).toHaveBeenLastCalledWith('libA', 'fA');
		libraryId = 'libB';
		fileId = 'fB';
		await store.run();
		expect(apiMock.files.transcribe).toHaveBeenLastCalledWith('libB', 'fB');
	});

	it('run() toasts an error and clears running on failure', async () => {
		apiMock.files.transcribe.mockRejectedValue(new Error('nope'));
		const setFile = vi.fn();
		const store = createTranscribeJob(
			() => 'lib1',
			() => 'f1',
			() => null,
			setFile,
			vi.fn()
		);

		await store.run();
		expect(setFile).not.toHaveBeenCalled();
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to queue transcription',
			color: 'error'
		});
		expect(store.running).toBe(false);
	});

	describe('sync()/stop() polling wiring', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => vi.useRealTimers());

		it('sync() polls refreshFile while in flight and stops on ready', () => {
			let file = makeFile({ transcribeStatus: 'processing' });
			const refreshFile = vi.fn();
			const store = createTranscribeJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				() => {},
				refreshFile
			);

			store.sync();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).toHaveBeenCalledTimes(2);

			file = makeFile({ transcribeStatus: 'ready' });
			store.sync();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).toHaveBeenCalledTimes(2); // timer stopped
		});

		it('sync() toasts success on a ready transition that was in flight', () => {
			let file = makeFile({ transcribeStatus: 'processing' });
			const store = createTranscribeJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				() => {},
				vi.fn()
			);

			store.sync();
			file = makeFile({ transcribeStatus: 'ready' });
			store.sync();
			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Transcription ready',
				color: 'success'
			});
		});

		it('sync() toasts failure with the transcribe error on a failed transition', () => {
			let file = makeFile({ transcribeStatus: 'queued' });
			const store = createTranscribeJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				() => {},
				vi.fn()
			);

			store.sync();
			file = makeFile({ transcribeStatus: 'failed', transcribeError: 'disk full' });
			store.sync();
			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Transcription failed',
				description: 'disk full',
				color: 'error'
			});
		});

		it('sync() does NOT toast when the status is already terminal on first observe', () => {
			const file = makeFile({ transcribeStatus: 'ready' });
			const store = createTranscribeJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				() => {},
				vi.fn()
			);
			store.sync();
			expect(toastMock.add).not.toHaveBeenCalled();
		});

		it('sync() treats a null file as a non-flight (null) status', () => {
			const refreshFile = vi.fn();
			const store = createTranscribeJob(
				() => 'lib1',
				() => 'f1',
				() => null,
				() => {},
				refreshFile
			);
			store.sync();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).not.toHaveBeenCalled();
		});

		it('stop() clears an in-flight poll timer', () => {
			const file = makeFile({ transcribeStatus: 'processing' });
			const refreshFile = vi.fn();
			const store = createTranscribeJob(
				() => 'lib1',
				() => 'f1',
				() => file,
				() => {},
				refreshFile
			);

			store.sync();
			store.stop();
			vi.advanceTimersByTime(4000);
			expect(refreshFile).not.toHaveBeenCalled();
		});
	});
});
