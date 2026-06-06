import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Moment } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	moments: {
		export: vi.fn(),
		downloadUrl: (libId: string, fileId: string, momentId: string) =>
			`/api/libraries/${libId}/files/${fileId}/moments/${momentId}/download`
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

import { createMomentDownloads } from './moment-downloads.svelte';

function makeMoment(over: Partial<Moment>): Moment {
	return {
		id: 'm1',
		libraryId: 'lib-1',
		fileId: 'file-1',
		createdById: 'u',
		name: 'n',
		description: 'd',
		startSeconds: 0,
		endSeconds: 1,
		exportStatus: null,
		exportProgress: null,
		exportEtaSeconds: null,
		exportVersion: 1,
		exportedVersion: null,
		trashedAt: null,
		createdAt: '',
		updatedAt: '',
		tags: [],
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createMomentDownloads', () => {
	it('redirects immediately when the moment export is fresh', async () => {
		const navigate = vi.fn();
		const moments = [
			makeMoment({ id: 'm1', exportStatus: 'ready', exportVersion: 1, exportedVersion: 1 })
		];
		const triggerExport = vi.fn();
		const store = createMomentDownloads({
			getLibraryId: () => 'lib-1',
			getFileId: () => 'file-1',
			getMoments: () => moments,
			triggerExport,
			navigate
		});

		await store.request('m1');

		expect(navigate).toHaveBeenCalledWith('/api/libraries/lib-1/files/file-1/moments/m1/download');
		expect(triggerExport).not.toHaveBeenCalled();
		expect(store.isPending('m1')).toBe(false);
		expect(store.pendingIds.size).toBe(0);
	});

	it('does nothing when the requested moment does not exist', async () => {
		const navigate = vi.fn();
		const triggerExport = vi.fn();
		const store = createMomentDownloads({
			getLibraryId: () => 'lib-1',
			getFileId: () => 'file-1',
			getMoments: () => [],
			triggerExport,
			navigate
		});

		await store.request('ghost');

		expect(navigate).not.toHaveBeenCalled();
		expect(triggerExport).not.toHaveBeenCalled();
		expect(store.isPending('ghost')).toBe(false);
	});

	it('queues the moment + triggers export + toasts when the export is stale', async () => {
		const navigate = vi.fn();
		const moments = [
			makeMoment({ id: 'm1', exportStatus: null, exportVersion: 2, exportedVersion: 1 })
		];
		const triggerExport = vi.fn().mockResolvedValue(undefined);
		const store = createMomentDownloads({
			getLibraryId: () => 'lib-1',
			getFileId: () => 'file-1',
			getMoments: () => moments,
			triggerExport,
			navigate
		});

		await store.request('m1');

		expect(triggerExport).toHaveBeenCalledWith('m1');
		expect(store.isPending('m1')).toBe(true);
		expect(navigate).not.toHaveBeenCalled();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Processing clip…', color: 'info' });
	});

	it('clears pending + toasts when triggerExport rejects', async () => {
		const navigate = vi.fn();
		const moments = [
			makeMoment({ id: 'm1', exportStatus: null, exportVersion: 2, exportedVersion: 1 })
		];
		const triggerExport = vi.fn().mockRejectedValue(new Error('boom'));
		const store = createMomentDownloads({
			getLibraryId: () => 'lib-1',
			getFileId: () => 'file-1',
			getMoments: () => moments,
			triggerExport,
			navigate
		});

		await store.request('m1');

		expect(store.isPending('m1')).toBe(false);
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to start export',
			color: 'error'
		});
	});

	it('falls back to api.moments.export when no triggerExport is provided', async () => {
		apiMock.moments.export.mockResolvedValue(makeMoment({ id: 'm1' }));
		const navigate = vi.fn();
		const moments = [
			makeMoment({ id: 'm1', exportStatus: null, exportVersion: 2, exportedVersion: 1 })
		];
		const store = createMomentDownloads({
			getLibraryId: () => 'lib-9',
			getFileId: () => 'file-9',
			getMoments: () => moments,
			navigate
		});

		await store.request('m1');

		expect(apiMock.moments.export).toHaveBeenCalledWith('lib-9', 'file-9', 'm1');
		expect(store.isPending('m1')).toBe(true);
		void moments;
	});

	it('default navigate is a no-op outside the browser (does not throw)', async () => {
		const moments = [
			makeMoment({ id: 'm1', exportStatus: 'ready', exportVersion: 1, exportedVersion: 1 })
		];
		const store = createMomentDownloads({
			getLibraryId: () => 'lib-1',
			getFileId: () => 'file-1',
			getMoments: () => moments
		});

		await expect(store.request('m1')).resolves.toBeUndefined();
		expect(store.isPending('m1')).toBe(false);
	});

	describe('sync()', () => {
		it('is a no-op when nothing is pending', () => {
			const navigate = vi.fn();
			const store = createMomentDownloads({
				getLibraryId: () => 'lib-1',
				getFileId: () => 'file-1',
				getMoments: () => [],
				navigate
			});

			store.sync();

			expect(navigate).not.toHaveBeenCalled();
			expect(toastMock.add).not.toHaveBeenCalled();
		});

		it('redirects + clears pending once the watched moment becomes ready', async () => {
			const navigate = vi.fn();
			let moments = [
				makeMoment({ id: 'm1', exportStatus: 'processing', exportVersion: 2, exportedVersion: 1 })
			];
			const store = createMomentDownloads({
				getLibraryId: () => 'lib-1',
				getFileId: () => 'file-1',
				getMoments: () => moments,
				triggerExport: vi.fn().mockResolvedValue(undefined),
				navigate
			});

			await store.request('m1');
			expect(store.isPending('m1')).toBe(true);

			moments = [
				makeMoment({ id: 'm1', exportStatus: 'ready', exportVersion: 2, exportedVersion: 2 })
			];
			store.sync();

			expect(navigate).toHaveBeenCalledWith(
				'/api/libraries/lib-1/files/file-1/moments/m1/download'
			);
			expect(store.isPending('m1')).toBe(false);
		});

		it('toasts + clears pending when the watched moment fails', async () => {
			const navigate = vi.fn();
			let moments = [
				makeMoment({ id: 'm1', exportStatus: 'processing', exportVersion: 2, exportedVersion: 1 })
			];
			const store = createMomentDownloads({
				getLibraryId: () => 'lib-1',
				getFileId: () => 'file-1',
				getMoments: () => moments,
				triggerExport: vi.fn().mockResolvedValue(undefined),
				navigate
			});

			await store.request('m1');
			toastMock.add.mockClear();

			moments = [
				makeMoment({ id: 'm1', exportStatus: 'failed', exportVersion: 2, exportedVersion: 1 })
			];
			store.sync();

			expect(store.isPending('m1')).toBe(false);
			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Export failed', color: 'error' });
			expect(navigate).not.toHaveBeenCalled();
		});

		it('drops a pending moment that vanished from the list', async () => {
			const navigate = vi.fn();
			let moments = [
				makeMoment({ id: 'm1', exportStatus: 'processing', exportVersion: 2, exportedVersion: 1 })
			];
			const store = createMomentDownloads({
				getLibraryId: () => 'lib-1',
				getFileId: () => 'file-1',
				getMoments: () => moments,
				triggerExport: vi.fn().mockResolvedValue(undefined),
				navigate
			});

			await store.request('m1');
			expect(store.isPending('m1')).toBe(true);

			moments = [];
			store.sync();

			expect(store.isPending('m1')).toBe(false);
			expect(navigate).not.toHaveBeenCalled();
			expect(toastMock.add).not.toHaveBeenCalledWith({ title: 'Export failed', color: 'error' });
		});

		it('leaves a still-processing moment pending and makes no changes', async () => {
			const navigate = vi.fn();
			const moments = [
				makeMoment({ id: 'm1', exportStatus: 'processing', exportVersion: 2, exportedVersion: 1 })
			];
			const store = createMomentDownloads({
				getLibraryId: () => 'lib-1',
				getFileId: () => 'file-1',
				getMoments: () => moments,
				triggerExport: vi.fn().mockResolvedValue(undefined),
				navigate
			});

			await store.request('m1');
			navigate.mockClear();
			toastMock.add.mockClear();

			store.sync();

			expect(store.isPending('m1')).toBe(true);
			expect(navigate).not.toHaveBeenCalled();
			expect(toastMock.add).not.toHaveBeenCalled();
		});
	});
});
