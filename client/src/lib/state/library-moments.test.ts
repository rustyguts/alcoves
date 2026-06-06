import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Moment } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	moments: {
		list: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		syncTags: vi.fn(),
		export: vi.fn()
	}
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({
	toast: { add: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { createLibraryMoments } from './library-moments.svelte';

function makeMoment(over: Partial<Moment>): Moment {
	return {
		id: 'm1',
		libraryId: 'lib1',
		fileId: 'file1',
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

function make(libId = 'lib1', fileId = 'file1') {
	return createLibraryMoments(
		() => libId,
		() => fileId
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createLibraryMoments', () => {
	it('starts with empty, non-loading state', () => {
		const store = make();
		expect(store.moments).toEqual([]);
		expect(store.loading).toBe(false);
		expect(store.error).toBeNull();
		expect(store.hasInFlight).toBe(false);
	});

	it('refresh() loads moments and clears loading', async () => {
		apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'm1' })]);
		const store = make();
		await store.refresh();
		expect(apiMock.moments.list).toHaveBeenCalledWith('lib1', 'file1');
		expect(store.moments).toHaveLength(1);
		expect(store.loading).toBe(false);
		expect(store.error).toBeNull();
	});

	it('refresh() short-circuits when the libraryId is empty', async () => {
		apiMock.moments.list.mockResolvedValue([]);
		const store = make('', 'file1');
		await store.refresh();
		expect(apiMock.moments.list).not.toHaveBeenCalled();
	});

	it('refresh() short-circuits when the fileId is empty', async () => {
		apiMock.moments.list.mockResolvedValue([]);
		const store = make('lib1', '');
		await store.refresh();
		expect(apiMock.moments.list).not.toHaveBeenCalled();
	});

	it('refresh() defaults to [] when the API returns nullish', async () => {
		apiMock.moments.list.mockResolvedValue(null);
		const store = make();
		await store.refresh();
		expect(store.moments).toEqual([]);
	});

	it('refresh() reads the id getters lazily', async () => {
		let lib = '';
		let file = '';
		apiMock.moments.list.mockResolvedValue([]);
		const store = createLibraryMoments(
			() => lib,
			() => file
		);
		await store.refresh();
		expect(apiMock.moments.list).not.toHaveBeenCalled();
		lib = 'lib2';
		file = 'file2';
		await store.refresh();
		expect(apiMock.moments.list).toHaveBeenCalledWith('lib2', 'file2');
	});

	it('refresh() captures errors and clears loading', async () => {
		apiMock.moments.list.mockRejectedValue(new Error('boom'));
		const store = make();
		await store.refresh();
		expect(store.error).toBeInstanceOf(Error);
		expect(store.loading).toBe(false);
	});

	it('create() appends and keeps moments sorted by startSeconds', async () => {
		const store = make();
		apiMock.moments.create.mockResolvedValueOnce(makeMoment({ id: 'a', startSeconds: 5 }));
		await store.create({ name: 'a', startSeconds: 5, endSeconds: 6 });
		apiMock.moments.create.mockResolvedValueOnce(makeMoment({ id: 'b', startSeconds: 1 }));
		await store.create({ name: 'b', startSeconds: 1, endSeconds: 2 });

		expect(apiMock.moments.create).toHaveBeenNthCalledWith(1, 'lib1', 'file1', {
			name: 'a',
			startSeconds: 5,
			endSeconds: 6
		});
		expect(store.moments.map((m) => m.id)).toEqual(['b', 'a']);
	});

	it('create() returns the created moment', async () => {
		const created = makeMoment({ id: 'new' });
		apiMock.moments.create.mockResolvedValue(created);
		const store = make();
		const result = await store.create({ startSeconds: 0, endSeconds: 1 });
		expect(result).toEqual(created);
	});

	it('update() replaces the moment and re-sorts', async () => {
		apiMock.moments.list.mockResolvedValue([
			makeMoment({ id: 'a', startSeconds: 5 }),
			makeMoment({ id: 'b', startSeconds: 1 })
		]);
		const store = make();
		await store.refresh();

		apiMock.moments.update.mockResolvedValue(makeMoment({ id: 'a', startSeconds: 0 }));
		const result = await store.update('a', { startSeconds: 0 });
		expect(apiMock.moments.update).toHaveBeenCalledWith('lib1', 'file1', 'a', { startSeconds: 0 });
		expect(result.id).toBe('a');
		expect(store.moments.map((m) => m.id)).toEqual(['a', 'b']);
		expect(store.moments.map((m) => m.startSeconds)).toEqual([0, 1]);
	});

	it('remove() filters out the deleted moment', async () => {
		apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a' }), makeMoment({ id: 'b' })]);
		apiMock.moments.delete.mockResolvedValue(undefined);
		const store = make();
		await store.refresh();
		await store.remove('a');
		expect(apiMock.moments.delete).toHaveBeenCalledWith('lib1', 'file1', 'a');
		expect(store.moments.map((m) => m.id)).toEqual(['b']);
	});

	it('syncTags() replaces the moment with the tagged version', async () => {
		apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', name: 'before' })]);
		const store = make();
		await store.refresh();
		apiMock.moments.syncTags.mockResolvedValue(makeMoment({ id: 'a', name: 'after' }));
		const result = await store.syncTags('a', ['t1', 't2']);
		expect(apiMock.moments.syncTags).toHaveBeenCalledWith('lib1', 'file1', 'a', ['t1', 't2']);
		expect(result.name).toBe('after');
		expect(store.moments[0]!.name).toBe('after');
	});

	it('triggerExport() swaps in the export-queued moment', async () => {
		apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: null })]);
		const store = make();
		await store.refresh();
		apiMock.moments.export.mockResolvedValue(makeMoment({ id: 'a', exportStatus: 'queued' }));
		const result = await store.triggerExport('a');
		expect(apiMock.moments.export).toHaveBeenCalledWith('lib1', 'file1', 'a');
		expect(result.exportStatus).toBe('queued');
		expect(store.moments[0]!.exportStatus).toBe('queued');
	});

	it('reports hasInFlight while a moment is queued or processing', async () => {
		apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'processing' })]);
		const store = make();
		await store.refresh();
		expect(store.hasInFlight).toBe(true);
	});

	it('reports hasInFlight for a queued moment', async () => {
		apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'queued' })]);
		const store = make();
		await store.refresh();
		expect(store.hasInFlight).toBe(true);
	});

	it('does not report hasInFlight when all moments are settled', async () => {
		apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'ready' })]);
		const store = make();
		await store.refresh();
		expect(store.hasInFlight).toBe(false);
	});

	describe('polling', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('polls while a moment is in flight and self-stops once it settles', async () => {
			apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'processing' })]);
			const store = make();
			await store.refresh();
			expect(apiMock.moments.list).toHaveBeenCalledTimes(1);
			expect(store.hasInFlight).toBe(true);

			store.startPolling();

			// next poll returns a settled moment
			apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'ready' })]);
			await vi.advanceTimersByTimeAsync(2000);
			expect(apiMock.moments.list).toHaveBeenCalledTimes(2);
			expect(store.hasInFlight).toBe(false);

			// now settled → the next tick self-stops, no further list calls
			await vi.advanceTimersByTimeAsync(6000);
			expect(apiMock.moments.list).toHaveBeenCalledTimes(2);
		});

		it('startPolling() is idempotent (no duplicate timers)', async () => {
			apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'processing' })]);
			const store = make();
			await store.refresh();
			store.startPolling();
			store.startPolling();
			await vi.advanceTimersByTimeAsync(2000);
			// one refresh per tick despite two startPolling calls
			expect(apiMock.moments.list).toHaveBeenCalledTimes(2);
		});

		it('the first tick self-stops when nothing is in flight', async () => {
			apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'ready' })]);
			const store = make();
			await store.refresh();
			expect(apiMock.moments.list).toHaveBeenCalledTimes(1);
			store.startPolling();
			await vi.advanceTimersByTimeAsync(2000);
			// no refresh: the tick saw nothing in flight and stopped
			expect(apiMock.moments.list).toHaveBeenCalledTimes(1);
			// and it stays stopped
			await vi.advanceTimersByTimeAsync(6000);
			expect(apiMock.moments.list).toHaveBeenCalledTimes(1);
		});

		it('stopPolling() halts the timer', async () => {
			apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'processing' })]);
			const store = make();
			await store.refresh();
			store.startPolling();
			store.stopPolling();
			await vi.advanceTimersByTimeAsync(6000);
			expect(apiMock.moments.list).toHaveBeenCalledTimes(1);
		});

		it('dispose() stops polling', async () => {
			apiMock.moments.list.mockResolvedValue([makeMoment({ id: 'a', exportStatus: 'processing' })]);
			const store = make();
			await store.refresh();
			store.startPolling();
			store.dispose();
			await vi.advanceTimersByTimeAsync(6000);
			expect(apiMock.moments.list).toHaveBeenCalledTimes(1);
		});

		it('stopPolling() is safe to call when not polling', () => {
			const store = make();
			expect(() => store.stopPolling()).not.toThrow();
		});
	});
});
