import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryFile } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({ files: { transcript: vi.fn() } }));
vi.mock('$lib/api', () => ({ api: apiMock }));

import { createTranscript } from './transcript.svelte';

function makeFile(over: Partial<LibraryFile>): LibraryFile {
	return {
		id: 'f1',
		libraryId: 'lib1',
		parentFolderId: null,
		name: 'clip.mp4',
		mimeType: 'video/mp4',
		size: 0,
		kind: 'file',
		duration: 10,
		width: null,
		height: null,
		proxyStatus: null,
		...over
	} as LibraryFile;
}

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createTranscript', () => {
	it('starts with a null vtt and empty cues', () => {
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => null
		);
		expect(store.vtt).toBeNull();
		expect(store.cues).toEqual([]);
	});

	it('sync() loads + parses the VTT when status is ready', async () => {
		apiMock.files.transcript.mockResolvedValue({ vtt: VTT });
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ transcribeStatus: 'ready' })
		);
		store.sync();
		await vi.waitFor(() => expect(store.vtt).toBe(VTT));
		expect(apiMock.files.transcript).toHaveBeenCalledWith('lib1', 'f1');
		expect(store.cues).toEqual([{ startSeconds: 1, endSeconds: 2, text: 'hello' }]);
	});

	it('sync() does not load when status is not ready, and cues stays empty', async () => {
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ transcribeStatus: 'processing' })
		);
		store.sync();
		await Promise.resolve();
		expect(apiMock.files.transcript).not.toHaveBeenCalled();
		expect(store.vtt).toBeNull();
		expect(store.cues).toEqual([]);
	});

	it('sync() clears the transcript when status leaves ready', async () => {
		apiMock.files.transcript.mockResolvedValue({ vtt: VTT });
		let file: LibraryFile = makeFile({ transcribeStatus: 'ready' });
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => file
		);
		store.sync();
		await vi.waitFor(() => expect(store.vtt).toBe(VTT));

		file = { ...file, transcribeStatus: 'processing' };
		store.sync();
		expect(store.vtt).toBeNull();
	});

	it('refresh() returns a null vtt when the file is missing', async () => {
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => null
		);
		await store.refresh();
		expect(apiMock.files.transcript).not.toHaveBeenCalled();
		expect(store.vtt).toBeNull();
	});

	it('refresh() returns a null vtt when the status is not ready', async () => {
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ transcribeStatus: 'failed' })
		);
		await store.refresh();
		expect(apiMock.files.transcript).not.toHaveBeenCalled();
		expect(store.vtt).toBeNull();
	});

	it('refresh() reads the id getters lazily', async () => {
		apiMock.files.transcript.mockResolvedValue({ vtt: VTT });
		let libraryId = 'lib1';
		let fileId = 'f1';
		const store = createTranscript(
			() => libraryId,
			() => fileId,
			() => makeFile({ transcribeStatus: 'ready' })
		);
		libraryId = 'lib2';
		fileId = 'f2';
		await store.refresh();
		expect(apiMock.files.transcript).toHaveBeenCalledWith('lib2', 'f2');
	});

	it('refresh() swallows API errors and nulls the vtt', async () => {
		apiMock.files.transcript.mockRejectedValue(new Error('boom'));
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ transcribeStatus: 'ready' })
		);
		await store.refresh();
		expect(store.vtt).toBeNull();
	});

	it('handles a transcript response with no vtt field', async () => {
		apiMock.files.transcript.mockResolvedValue({});
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ transcribeStatus: 'ready' })
		);
		await store.refresh();
		expect(store.vtt).toBeNull();
	});

	it('handles a nullish transcript response', async () => {
		apiMock.files.transcript.mockResolvedValue(null);
		const store = createTranscript(
			() => 'lib1',
			() => 'f1',
			() => makeFile({ transcribeStatus: 'ready' })
		);
		await store.refresh();
		expect(store.vtt).toBeNull();
	});
});
