import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryFile, LibraryFolder, PaginatedFiles } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	libraries: {
		timeline: vi.fn(),
		timelineHistogram: vi.fn()
	}
}));

// The store reads the persisted type filter from localStorage when `browser` is
// true. Run these node tests as if in the browser, backed by an in-memory
// localStorage shim, so the persistence behaviour is exercised faithfully.
vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({
	toast: { add: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { createLibraryTimeline } from './library-timeline.svelte';

const mockTimeline = apiMock.libraries.timeline;
const mockHistogram = apiMock.libraries.timelineHistogram;

function makeFile(id: string, over: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id,
		libraryId: 'lib-1',
		parentFolderId: null,
		name: id,
		mimeType: 'image/jpeg',
		size: 1,
		kind: 'file',
		duration: null,
		width: null,
		height: null,
		proxyStatus: null,
		thumbnailFileId: null,
		sourceFileId: null,
		originalCreatedAt: null,
		capturedAt: null,
		hash: null,
		trashedAt: null,
		createdAt: '2026-01-01T12:00:00Z',
		updatedAt: '2026-01-01T12:00:00Z',
		owner: null,
		tags: [],
		...over
	};
}

function makeFolder(id: string): LibraryFolder {
	return {
		id,
		libraryId: 'lib-1',
		parentFolderId: null,
		name: id,
		kind: 'folder',
		trashedAt: null,
		createdAt: '2026-01-01T12:00:00Z',
		updatedAt: '2026-01-01T12:00:00Z',
		owner: null,
		tags: []
	};
}

function page(
	entries: (LibraryFile | LibraryFolder)[],
	nextCursor: string | null,
	total = entries.length
): PaginatedFiles {
	return { entries, nextCursor, totalCount: total, breadcrumbs: [], currentFolderId: null };
}

// In-memory localStorage shim for the node project.
function installLocalStorage() {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, String(v)),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	installLocalStorage();
});

describe('createLibraryTimeline', () => {
	it('starts with empty, non-loading state', () => {
		const tl = createLibraryTimeline(() => 'lib-1');
		expect(tl.entries).toEqual([]);
		expect(tl.nextCursor).toBeNull();
		expect(tl.totalCount).toBe(0);
		expect(tl.loading).toBe(false);
		expect(tl.loadingMore).toBe(false);
		expect(tl.error).toBeNull();
		expect(tl.histogram).toBeNull();
		expect(tl.typeFilter).toBe('media');
		expect(tl.groups).toEqual([]);
		expect(tl.buckets).toEqual([]);
	});

	it('loadFirst fetches with type=media and populates files + total', async () => {
		mockTimeline.mockResolvedValueOnce(page([makeFile('a'), makeFile('b')], 'c1', 2));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();

		expect(tl.entries.map((f) => f.id)).toEqual(['a', 'b']);
		expect(tl.nextCursor).toBe('c1');
		expect(tl.totalCount).toBe(2);
		expect(mockTimeline).toHaveBeenCalledWith('lib-1', { type: 'media' });
	});

	it('reads the libraryId getter lazily', async () => {
		let id = 'lib-1';
		mockTimeline.mockResolvedValue(page([makeFile('a')], null));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => id);
		id = 'lib-2';
		await tl.loadFirst();

		expect(mockTimeline).toHaveBeenCalledWith('lib-2', { type: 'media' });
	});

	it('filters out folder entries (timeline is files-only)', async () => {
		mockTimeline.mockResolvedValueOnce(page([makeFolder('dir'), makeFile('a')], null, 1));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();

		expect(tl.entries.map((f) => f.id)).toEqual(['a']);
	});

	it('loadMore appends and forwards the cursor + current type', async () => {
		mockTimeline
			.mockResolvedValueOnce(page([makeFile('a')], 'c1'))
			.mockResolvedValueOnce(page([makeFile('b')], null));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();
		await tl.loadMore();

		expect(mockTimeline).toHaveBeenLastCalledWith('lib-1', { type: 'media', cursor: 'c1' });
		expect(tl.entries.map((f) => f.id)).toEqual(['a', 'b']);
		expect(tl.nextCursor).toBeNull();
	});

	it('loadMore is a no-op when there is no next cursor', async () => {
		mockTimeline.mockResolvedValueOnce(page([makeFile('a')], null));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();
		mockTimeline.mockClear();
		await tl.loadMore();

		expect(mockTimeline).not.toHaveBeenCalled();
	});

	it('loadMore captures an error from the follow-up page', async () => {
		mockTimeline
			.mockResolvedValueOnce(page([makeFile('a')], 'c1'))
			.mockRejectedValueOnce(new Error('page boom'));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();
		await tl.loadMore();

		expect(tl.error).toBe('page boom');
		expect(tl.loadingMore).toBe(false);
		expect(tl.entries.map((f) => f.id)).toEqual(['a']);
	});

	it('groups entries into day buckets by capturedAt', async () => {
		mockTimeline.mockResolvedValueOnce(
			page(
				[
					makeFile('a', { capturedAt: '2026-06-04T10:00:00Z' }),
					makeFile('b', { capturedAt: '2026-06-04T18:00:00Z' }),
					makeFile('c', { capturedAt: '2026-06-01T09:00:00Z' })
				],
				null,
				3
			)
		);
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();

		expect(tl.groups).toHaveLength(2);
		expect(tl.groups[0]!.files.map((f) => f.id)).toEqual(['a', 'b']);
		expect(tl.groups[1]!.files.map((f) => f.id)).toEqual(['c']);
	});

	it('buckets by UTC day (deterministic across the viewer timezone)', async () => {
		// Two instants straddling a UTC midnight: they must land in separate UTC
		// days (June 4 vs June 5) regardless of the machine's local timezone.
		mockTimeline.mockResolvedValueOnce(
			page(
				[
					makeFile('late', { capturedAt: '2026-06-04T23:30:00Z' }),
					makeFile('early', { capturedAt: '2026-06-05T00:30:00Z' })
				],
				null,
				2
			)
		);
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();

		expect(tl.groups).toHaveLength(2);
		expect(tl.groups[0]!.files.map((f) => f.id)).toEqual(['late']);
		expect(tl.groups[1]!.files.map((f) => f.id)).toEqual(['early']);
		expect(tl.groups[0]!.label).toContain('June 4');
		expect(tl.groups[1]!.label).toContain('June 5');
	});

	it('groups by originalCreatedAt when capturedAt is absent (matches backend COALESCE)', async () => {
		mockTimeline.mockResolvedValueOnce(
			page(
				[
					makeFile('a', {
						capturedAt: null,
						originalCreatedAt: '2026-03-10T00:00:00Z',
						createdAt: '2020-01-01T00:00:00Z'
					})
				],
				null,
				1
			)
		);
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();

		expect(tl.groups).toHaveLength(1);
		expect(tl.groups[0]!.label).toContain('March 10');
	});

	it('labels an unparseable date as "Unknown date"', async () => {
		mockTimeline.mockResolvedValueOnce(
			page([makeFile('a', { capturedAt: 'not-a-date' })], null, 1)
		);
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();

		expect(tl.groups[0]!.label).toBe('Unknown date');
	});

	it('setType switches filter, persists it, and refetches', async () => {
		mockTimeline
			.mockResolvedValueOnce(page([makeFile('a')], null))
			.mockResolvedValueOnce(page([makeFile('a'), makeFolder('d')], null, 2));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();
		tl.setType('all');
		await Promise.resolve();
		await Promise.resolve();

		expect(tl.typeFilter).toBe('all');
		expect(mockTimeline).toHaveBeenLastCalledWith('lib-1', { type: 'all' });
		expect(localStorage.getItem('alcoves.timeline.type')).toBe('all');
	});

	it('setType is a no-op when the filter is unchanged', async () => {
		const tl = createLibraryTimeline(() => 'lib-1');
		tl.setType('media');
		await Promise.resolve();
		expect(mockTimeline).not.toHaveBeenCalled();
	});

	it('restores the persisted filter on construction', () => {
		localStorage.setItem('alcoves.timeline.type', 'all');
		const tl = createLibraryTimeline(() => 'lib-1');
		expect(tl.typeFilter).toBe('all');
	});

	it('restores a persisted "media" filter on construction', () => {
		localStorage.setItem('alcoves.timeline.type', 'media');
		const tl = createLibraryTimeline(() => 'lib-1');
		expect(tl.typeFilter).toBe('media');
	});

	it('ignores an invalid persisted filter value', () => {
		localStorage.setItem('alcoves.timeline.type', 'bogus');
		const tl = createLibraryTimeline(() => 'lib-1');
		expect(tl.typeFilter).toBe('media');
	});

	it('captures the error message on a failed load', async () => {
		mockTimeline.mockRejectedValueOnce(new Error('boom'));
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();

		expect(tl.error).toBe('boom');
		expect(tl.entries).toHaveLength(0);
		expect(tl.loading).toBe(false);
	});

	it('uses the histogram endpoint for scrubber buckets', async () => {
		const buckets = [
			{ year: 2026, month: 1, count: 5 },
			{ year: 2025, month: 12, count: 3 }
		];
		mockHistogram.mockResolvedValue({ buckets, totalCount: 8 });

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadHistogram();

		expect(tl.buckets).toEqual(buckets);
		expect(tl.histogram).toEqual(buckets);
		expect(mockHistogram).toHaveBeenCalledWith('lib-1', { type: 'media' });
	});

	it('falls back to buckets derived from loaded pages when the histogram fails', async () => {
		mockHistogram.mockRejectedValue(new Error('no histogram'));
		mockTimeline.mockResolvedValueOnce(
			page(
				[
					makeFile('a', { capturedAt: '2026-01-15T00:00:00Z' }),
					makeFile('b', { capturedAt: '2026-01-20T00:00:00Z' }),
					makeFile('c', { capturedAt: '2025-12-02T00:00:00Z' })
				],
				null,
				3
			)
		);

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();
		await tl.loadHistogram();

		expect(tl.histogram).toBeNull();
		expect(tl.buckets).toEqual([
			{ year: 2026, month: 1, count: 2 },
			{ year: 2025, month: 12, count: 1 }
		]);
	});

	it('derived buckets skip files with an unparseable date', async () => {
		mockHistogram.mockRejectedValue(new Error('no histogram'));
		mockTimeline.mockResolvedValueOnce(
			page(
				[
					makeFile('good', { capturedAt: '2026-02-10T00:00:00Z' }),
					makeFile('bad', { capturedAt: 'nonsense' })
				],
				null,
				2
			)
		);

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();
		await tl.loadHistogram();

		expect(tl.buckets).toEqual([{ year: 2026, month: 2, count: 1 }]);
	});

	it('falls back to derived buckets when the histogram is empty', async () => {
		mockHistogram.mockResolvedValue({ buckets: [], totalCount: 0 });
		mockTimeline.mockResolvedValueOnce(
			page([makeFile('a', { capturedAt: '2026-04-01T00:00:00Z' })], null, 1)
		);

		const tl = createLibraryTimeline(() => 'lib-1');
		await tl.loadFirst();
		await tl.loadHistogram();

		expect(tl.histogram).toEqual([]);
		expect(tl.buckets).toEqual([{ year: 2026, month: 4, count: 1 }]);
	});
});
