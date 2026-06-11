import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioDetection } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	files: {
		audioDetections: vi.fn()
	}
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({
	toast: { add: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { createAudioDetections } from './audio-detections.svelte';

const det: AudioDetection = {
	id: 'd1',
	fileId: 'f1',
	libraryId: 'lib1',
	label: 'Laughter',
	classIndex: 0,
	score: 0.7,
	startSeconds: 1,
	endSeconds: 2,
	version: 1,
	createdAt: ''
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createAudioDetections', () => {
	it('starts with an empty list', () => {
		const store = createAudioDetections(
			() => 'lib1',
			() => 'f1'
		);
		expect(store.detections).toEqual([]);
	});

	it('refresh() loads detections using the id getters', async () => {
		apiMock.files.audioDetections.mockResolvedValue([det]);
		const store = createAudioDetections(
			() => 'lib1',
			() => 'f1'
		);
		await store.refresh();
		expect(apiMock.files.audioDetections).toHaveBeenCalledWith('lib1', 'f1');
		expect(store.detections).toEqual([det]);
	});

	it('refresh() reads the id getters lazily', async () => {
		let libraryId = 'libA';
		let fileId = 'fA';
		apiMock.files.audioDetections.mockResolvedValue([]);
		const store = createAudioDetections(
			() => libraryId,
			() => fileId
		);
		await store.refresh();
		expect(apiMock.files.audioDetections).toHaveBeenLastCalledWith('libA', 'fA');
		libraryId = 'libB';
		fileId = 'fB';
		await store.refresh();
		expect(apiMock.files.audioDetections).toHaveBeenLastCalledWith('libB', 'fB');
	});

	it('refresh() falls back to [] when the API returns nullish', async () => {
		apiMock.files.audioDetections.mockResolvedValue(null);
		const store = createAudioDetections(
			() => 'lib1',
			() => 'f1'
		);
		await store.refresh();
		expect(store.detections).toEqual([]);
	});

	it('refresh() swallows API errors and resets to []', async () => {
		apiMock.files.audioDetections.mockResolvedValue([det]);
		const store = createAudioDetections(
			() => 'lib1',
			() => 'f1'
		);
		await store.refresh();
		expect(store.detections).toEqual([det]);

		apiMock.files.audioDetections.mockRejectedValue(new Error('boom'));
		await store.refresh();
		expect(store.detections).toEqual([]);
	});

	it('load() fetches with explicit ids (ignoring the getters)', async () => {
		apiMock.files.audioDetections.mockResolvedValue([det]);
		const store = createAudioDetections(
			() => 'lib1',
			() => 'f1'
		);
		await store.load('lib2', 'f2');
		expect(apiMock.files.audioDetections).toHaveBeenCalledWith('lib2', 'f2');
		expect(store.detections).toEqual([det]);
	});

	it('load() falls back to [] when the API returns nullish', async () => {
		apiMock.files.audioDetections.mockResolvedValue(undefined);
		const store = createAudioDetections(
			() => 'lib1',
			() => 'f1'
		);
		await store.load('lib2', 'f2');
		expect(store.detections).toEqual([]);
	});

	it('load() swallows API errors and resets to []', async () => {
		apiMock.files.audioDetections.mockResolvedValue([det]);
		const store = createAudioDetections(
			() => 'lib1',
			() => 'f1'
		);
		await store.load('lib2', 'f2');
		expect(store.detections).toEqual([det]);

		apiMock.files.audioDetections.mockRejectedValue(new Error('boom'));
		await store.load('lib2', 'f2');
		expect(store.detections).toEqual([]);
	});
});
