import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryFile, WaveformData } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	files: {
		waveform: vi.fn()
	}
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({
	toast: { add: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { createWaveform } from './waveform.svelte';

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

describe('createWaveform', () => {
	it('starts with null data and the default peaksPerSecond', () => {
		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ waveformStatus: 'queued' })
		);
		expect(store.data).toBeNull();
		expect(store.peaks).toBeNull();
		expect(store.peaksPerSecond).toBe(50);
	});

	it('does not fetch and clears data when the file is missing', async () => {
		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => null
		);
		await store.refresh();
		expect(apiMock.files.waveform).not.toHaveBeenCalled();
		expect(store.data).toBeNull();
		expect(store.peaks).toBeNull();
	});

	it('does not fetch when status is not ready', async () => {
		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ waveformStatus: 'queued' })
		);
		await store.refresh();
		expect(apiMock.files.waveform).not.toHaveBeenCalled();
		expect(store.peaks).toBeNull();
	});

	it('fetches when status is ready and exposes peaks + peaksPerSecond', async () => {
		const data: WaveformData = { peaks: [0.1, 0.5], peaksPerSecond: 50 };
		apiMock.files.waveform.mockResolvedValue(data);

		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ waveformStatus: 'ready' })
		);
		await store.refresh();

		expect(apiMock.files.waveform).toHaveBeenCalledWith('lib1', 'f1');
		expect(store.data).toEqual(data);
		expect(store.peaks).toEqual([0.1, 0.5]);
		expect(store.peaksPerSecond).toBe(50);
	});

	it('reads the id getters lazily on each refresh', async () => {
		apiMock.files.waveform.mockResolvedValue({ peaks: [0.2], peaksPerSecond: 25 });
		let libraryId = 'lib1';
		let fileId = 'f1';
		const store = createWaveform(
			() => libraryId,
			() => fileId,
			() => makeFile({ waveformStatus: 'ready' })
		);

		await store.refresh();
		expect(apiMock.files.waveform).toHaveBeenLastCalledWith('lib1', 'f1');

		libraryId = 'lib2';
		fileId = 'f2';
		await store.refresh();
		expect(apiMock.files.waveform).toHaveBeenLastCalledWith('lib2', 'f2');
		expect(store.peaksPerSecond).toBe(25);
	});

	it('uses the API-provided peaksPerSecond instead of the default', async () => {
		apiMock.files.waveform.mockResolvedValue({ peaks: [0.3, 0.4], peaksPerSecond: 100 });
		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ waveformStatus: 'ready' })
		);
		await store.refresh();
		expect(store.peaksPerSecond).toBe(100);
	});

	it('clears data when the file status leaves ready on a subsequent refresh', async () => {
		apiMock.files.waveform.mockResolvedValue({ peaks: [0.9], peaksPerSecond: 50 });
		let status: LibraryFile['waveformStatus'] = 'ready';
		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ waveformStatus: status })
		);

		await store.refresh();
		expect(store.peaks).toEqual([0.9]);

		status = 'failed';
		await store.refresh();
		expect(store.data).toBeNull();
		expect(store.peaks).toBeNull();
	});

	it('swallows fetch errors and leaves data null', async () => {
		apiMock.files.waveform.mockRejectedValue(new Error('boom'));
		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ waveformStatus: 'ready' })
		);
		await store.refresh();
		expect(store.data).toBeNull();
		expect(store.peaks).toBeNull();
		expect(store.peaksPerSecond).toBe(50);
	});

	it('clears previously loaded data when a later refresh errors', async () => {
		apiMock.files.waveform.mockResolvedValueOnce({ peaks: [0.7], peaksPerSecond: 50 });
		const store = createWaveform(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ waveformStatus: 'ready' })
		);
		await store.refresh();
		expect(store.peaks).toEqual([0.7]);

		apiMock.files.waveform.mockRejectedValueOnce(new Error('nope'));
		await store.refresh();
		expect(store.data).toBeNull();
	});
});
