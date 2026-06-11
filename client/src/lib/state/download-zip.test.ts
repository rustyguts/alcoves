import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apiMock = vi.hoisted(() => ({
	downloads: {
		estimate: vi.fn(),
		url: (libraryId: string) => `/api/libraries/${libraryId}/download`
	}
}));

const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { createDownloadZip } from './download-zip.svelte';

const HUGE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', fetchMock);
	vi.stubGlobal('URL', {
		...globalThis.URL,
		createObjectURL: vi.fn(() => 'blob:mock-url'),
		revokeObjectURL: vi.fn()
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function setup(getLibraryId: () => string = () => 'lib-123') {
	return createDownloadZip(getLibraryId);
}

describe('createDownloadZip', () => {
	describe('startDownload', () => {
		it('fetches size estimate before downloading', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 1000, fileCount: 2 });
			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(new Blob(['zip']))
			});

			const store = setup();
			await store.startDownload(['file-1', 'file-2'], []);

			expect(apiMock.downloads.estimate).toHaveBeenCalledWith('lib-123', {
				fileIds: ['file-1', 'file-2'],
				folderIds: []
			});
		});

		it('initiates download for small files', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 1000, fileCount: 2 });
			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(new Blob(['zip']))
			});

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(fetchMock).toHaveBeenCalledWith('/api/libraries/lib-123/download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileIds: ['file-1'], folderIds: [], skipSizeCheck: false }),
				credentials: 'include'
			});
		});

		it('shows size warning for files exceeding 4GB', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: HUGE_SIZE, fileCount: 100 });

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(store.showSizeWarning).toBe(true);
			expect(store.estimatedSize).toBe(HUGE_SIZE);
			expect(store.estimatedFileCount).toBe(100);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('shows warning when no files found', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 0, fileCount: 0 });

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'No files to download',
				color: 'warning'
			});
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('handles download error with statusMessage', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 1000, fileCount: 1 });
			fetchMock.mockResolvedValue({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ statusMessage: 'Server error' })
			});

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Server error',
				color: 'error'
			});
			expect(store.downloading).toBe(false);
		});

		it('falls back to a generic message when the error body is unparseable', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 1000, fileCount: 1 });
			fetchMock.mockResolvedValue({
				ok: false,
				status: 500,
				json: () => Promise.reject(new Error('not json'))
			});

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Download failed',
				color: 'error'
			});
		});

		it('handles 413 error with size data', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 1000, fileCount: 1 });
			fetchMock.mockResolvedValue({
				ok: false,
				status: 413,
				json: () => Promise.resolve({ data: { totalSize: HUGE_SIZE, fileCount: 500 } })
			});

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(store.showSizeWarning).toBe(true);
			expect(store.estimatedSize).toBe(HUGE_SIZE);
			expect(store.estimatedFileCount).toBe(500);
		});

		it('treats a 413 without data as a generic failure', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 1000, fileCount: 1 });
			fetchMock.mockResolvedValue({
				ok: false,
				status: 413,
				json: () => Promise.resolve({ statusMessage: 'Too large' })
			});

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(store.showSizeWarning).toBe(false);
			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Too large', color: 'error' });
		});

		it('skips size check when skipSizeCheck is true', async () => {
			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(new Blob(['zip']))
			});

			const store = setup();
			await store.startDownload(['file-1'], [], true);

			expect(apiMock.downloads.estimate).not.toHaveBeenCalled();
			expect(fetchMock).toHaveBeenCalled();
		});

		it('sets downloading state correctly', async () => {
			let resolvePromise: (value: unknown) => void;
			const promise = new Promise((resolve) => {
				resolvePromise = resolve;
			});
			apiMock.downloads.estimate.mockReturnValue(promise);

			const store = setup();
			expect(store.downloading).toBe(false);

			const downloadPromise = store.startDownload(['file-1'], []);
			expect(store.downloading).toBe(true);

			resolvePromise!({ totalSize: 0, fileCount: 0 });
			await downloadPromise;
			expect(store.downloading).toBe(false);
		});

		it('supports folder downloads', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 5000, fileCount: 10 });
			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(new Blob(['zip']))
			});

			const store = setup();
			await store.startDownload([], ['folder-1', 'folder-2']);

			expect(apiMock.downloads.estimate).toHaveBeenCalledWith('lib-123', {
				fileIds: [],
				folderIds: ['folder-1', 'folder-2']
			});
			expect(fetchMock).toHaveBeenCalledWith('/api/libraries/lib-123/download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fileIds: [],
					folderIds: ['folder-1', 'folder-2'],
					skipSizeCheck: false
				}),
				credentials: 'include'
			});
		});

		it('supports mixed file and folder downloads', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 3000, fileCount: 5 });
			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(new Blob(['zip']))
			});

			const store = setup();
			await store.startDownload(['file-1'], ['folder-1']);

			expect(apiMock.downloads.estimate).toHaveBeenCalledWith('lib-123', {
				fileIds: ['file-1'],
				folderIds: ['folder-1']
			});
		});

		it('creates a download link, clicks it, and revokes the object URL', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 100, fileCount: 1 });
			const mockBlob = new Blob(['zip-content']);
			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(mockBlob)
			});

			const clickSpy = vi.fn();
			const setHref = vi.fn();
			const setDownload = vi.fn();
			const createElement = vi.fn(() => ({
				set href(v: string) {
					setHref(v);
				},
				set download(v: string) {
					setDownload(v);
				},
				click: clickSpy
			}));
			vi.stubGlobal('document', { createElement });

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(createElement).toHaveBeenCalledWith('a');
			expect(setHref).toHaveBeenCalledWith('blob:mock-url');
			expect(setDownload).toHaveBeenCalledWith(expect.stringMatching(/^alcoves-download-.*\.zip$/));
			expect(clickSpy).toHaveBeenCalled();
			expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Download started' });
		});
	});

	describe('confirmLargeDownload', () => {
		it('proceeds with download skipping size check', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: HUGE_SIZE, fileCount: 100 });

			const store = setup();
			await store.startDownload(['file-1'], []);
			expect(store.showSizeWarning).toBe(true);

			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(new Blob(['zip']))
			});

			await store.confirmLargeDownload();

			expect(store.showSizeWarning).toBe(false);
			expect(fetchMock).toHaveBeenCalledWith('/api/libraries/lib-123/download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileIds: ['file-1'], folderIds: [], skipSizeCheck: true }),
				credentials: 'include'
			});
		});

		it('does nothing when no pending download', async () => {
			const store = setup();
			await store.confirmLargeDownload();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('cancelLargeDownload', () => {
		it('resets warning state', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: HUGE_SIZE, fileCount: 100 });

			const store = setup();
			await store.startDownload(['file-1'], []);
			expect(store.showSizeWarning).toBe(true);

			store.cancelLargeDownload();

			expect(store.showSizeWarning).toBe(false);
			expect(store.estimatedSize).toBe(0);
			expect(store.estimatedFileCount).toBe(0);
		});
	});

	describe('formattedEstimatedSize', () => {
		it('formats size correctly', async () => {
			apiMock.downloads.estimate.mockResolvedValue({ totalSize: HUGE_SIZE, fileCount: 1 });

			const store = setup();
			await store.startDownload(['file-1'], []);

			expect(store.formattedEstimatedSize).toContain('5');
			expect(store.formattedEstimatedSize).toContain('GB');
		});
	});

	describe('uses correct library id', () => {
		it('reads the latest libraryId from the getter on each call', async () => {
			let libraryId = 'lib-1';
			const store = setup(() => libraryId);

			apiMock.downloads.estimate.mockResolvedValue({ totalSize: 100, fileCount: 1 });
			fetchMock.mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(new Blob(['zip']))
			});

			await store.startDownload(['file-1'], []);
			expect(apiMock.downloads.estimate).toHaveBeenCalledWith('lib-1', expect.any(Object));

			libraryId = 'lib-2';
			await store.startDownload(['file-2'], []);
			expect(apiMock.downloads.estimate).toHaveBeenCalledWith('lib-2', expect.any(Object));
		});
	});
});
