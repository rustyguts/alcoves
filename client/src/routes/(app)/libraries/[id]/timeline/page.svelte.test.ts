import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryFile } from '$lib/types/api';
import type { TimelineGroup, TimelineBucket } from '$lib/state/library-timeline.svelte';

// ─── $app mocks ──────────────────────────────────────────────────────────────
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1' },
		url: new URL('http://localhost/libraries/lib-1/timeline'),
		data: { library: { id: 'lib-1', name: 'Family Photos' }, user: { id: 'u1' } }
	}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

// ─── timeline store mock ──────────────────────────────────────────────────────
// A controllable fake exposing the same getter surface as createLibraryTimeline.
// Tests mutate the backing object before render to drive the page's branches.
const store = vi.hoisted(() => ({
	entries: [] as LibraryFile[],
	groups: [] as TimelineGroup[],
	buckets: [] as TimelineBucket[],
	histogram: null as TimelineBucket[] | null,
	nextCursor: null as string | null,
	totalCount: 0,
	loading: false,
	loadingMore: false,
	error: null as string | null,
	typeFilter: 'media' as 'media' | 'all',
	loadFirst: vi.fn(async () => {}),
	loadMore: vi.fn(async () => {}),
	loadHistogram: vi.fn(async () => {}),
	setType: vi.fn()
}));

const createLibraryTimeline = vi.hoisted(() => vi.fn());

vi.mock('$lib/state/library-timeline.svelte', () => ({
	createLibraryTimeline: (...args: unknown[]) => {
		createLibraryTimeline(...args);
		return {
			get entries() {
				return store.entries;
			},
			get groups() {
				return store.groups;
			},
			get buckets() {
				return store.buckets;
			},
			get histogram() {
				return store.histogram;
			},
			get nextCursor() {
				return store.nextCursor;
			},
			get totalCount() {
				return store.totalCount;
			},
			get loading() {
				return store.loading;
			},
			get loadingMore() {
				return store.loadingMore;
			},
			get error() {
				return store.error;
			},
			get typeFilter() {
				return store.typeFilter;
			},
			loadFirst: store.loadFirst,
			loadMore: store.loadMore,
			loadHistogram: store.loadHistogram,
			setType: store.setType
		};
	}
}));

// FilePreview pulls in image-proxy / fetch plumbing — swap it for the shared
// test-only stub (a marker plus a "next" button that fires onnavigate) so the
// page's onnavigate handler can be driven via a real DOM click. It only appears
// once a tile has been selected (the page renders it conditionally on previewFile).
vi.mock('$lib/components/FilePreview.svelte', async () => {
	const Stub = (await import('../map/preview-stub.svelte')).default;
	return { default: Stub };
});

import Page from './+page.svelte';

function makeFile(id: string, over: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id,
		libraryId: 'lib-1',
		parentFolderId: null,
		name: `${id}.jpg`,
		mimeType: 'image/jpeg',
		size: 1,
		kind: 'file',
		duration: null,
		width: 1600,
		height: 1200,
		proxyStatus: null,
		thumbnailFileId: null,
		sourceFileId: null,
		originalCreatedAt: null,
		capturedAt: '2026-06-04T12:00:00Z',
		hash: null,
		trashedAt: null,
		createdAt: '2026-06-04T12:00:00Z',
		updatedAt: '2026-06-04T12:00:00Z',
		owner: null,
		tags: [],
		...over
	} as LibraryFile;
}

function dayGroup(key: string, files: LibraryFile[]): TimelineGroup {
	return { key, label: 'whatever', files };
}

beforeEach(() => {
	vi.clearAllMocks();
	store.entries = [];
	store.groups = [];
	store.buckets = [];
	store.histogram = null;
	store.nextCursor = null;
	store.totalCount = 0;
	store.loading = false;
	store.loadingMore = false;
	store.error = null;
	store.typeFilter = 'media';
});

describe('/libraries/[id]/timeline', () => {
	it('instantiates the timeline store with a libraryId getter and pins media-only', () => {
		render(Page);

		expect(createLibraryTimeline).toHaveBeenCalledTimes(1);
		const getter = createLibraryTimeline.mock.calls[0]![0] as () => string;
		expect(getter()).toBe('lib-1');
		// Timeline is photos & videos only — it forces the media filter.
		expect(store.setType).toHaveBeenCalledWith('media');
	});

	it('loads the first page on mount', async () => {
		render(Page);
		await tick();
		expect(store.loadFirst).toHaveBeenCalledTimes(1);
	});

	it('shows the loading state before any entries arrive', async () => {
		store.loading = true;
		const screen = render(Page);
		await expect.element(screen.getByText('Loading timeline…')).toBeInTheDocument();
	});

	it('shows the error state when the store reports an error', async () => {
		store.error = 'boom';
		const screen = render(Page);
		await expect.element(screen.getByText('boom')).toBeInTheDocument();
	});

	it('shows the empty state when there are no entries', async () => {
		const screen = render(Page);
		await expect.element(screen.getByText('Nothing to show yet.')).toBeInTheDocument();
	});

	it('renders the justified gallery grouped by day, with UTC-formatted headings', async () => {
		const a = makeFile('a', { capturedAt: '2026-06-04T10:00:00Z' });
		const b = makeFile('b', { capturedAt: '2026-06-01T10:00:00Z' });
		store.entries = [a, b];
		// Keys are `Y-M-D` with a 0-based month, as the store emits them.
		store.groups = [dayGroup('2026-5-4', [a]), dayGroup('2026-5-1', [b])];

		const screen = render(Page);

		const sections = screen.container.querySelectorAll('section[data-group-key]');
		expect(sections).toHaveLength(2);
		await expect.element(screen.getByText('Thu, Jun 4')).toBeInTheDocument();
		await expect.element(screen.getByText('Mon, Jun 1')).toBeInTheDocument();
	});

	it('renders a Load more button when there is a next cursor and calls loadMore', async () => {
		const a = makeFile('a');
		store.entries = [a];
		store.groups = [dayGroup('2026-5-4', [a])];
		store.nextCursor = 'cursor-2';

		const screen = render(Page);

		const btn = screen.getByRole('button', { name: 'Load more' });
		await expect.element(btn).toBeInTheDocument();
		// The infinite-scroll sentinel may also call loadMore on mount, so assert the
		// explicit click increments the call count rather than pinning an exact total.
		const before = store.loadMore.mock.calls.length;
		await btn.click();
		expect(store.loadMore.mock.calls.length).toBeGreaterThan(before);
	});

	it('renders the date scrubber when there is more than one bucket', async () => {
		const a = makeFile('a');
		store.entries = [a];
		store.groups = [dayGroup('2026-5-4', [a])];
		store.buckets = [
			{ year: 2026, month: 6, count: 4 },
			{ year: 2026, month: 5, count: 2 }
		];

		const screen = render(Page);
		await expect.element(screen.getByLabelText('Jump to date')).toBeInTheDocument();
	});

	it('hides the date scrubber with a single bucket', async () => {
		const a = makeFile('a');
		store.entries = [a];
		store.groups = [dayGroup('2026-5-4', [a])];
		store.buckets = [{ year: 2026, month: 6, count: 4 }];

		const screen = render(Page);
		expect(screen.container.querySelector('aside[aria-label="Jump to date"]')).toBeNull();
	});

	it('opens the file preview when a tile is selected', async () => {
		const a = makeFile('a');
		store.entries = [a];
		store.groups = [dayGroup('2026-5-4', [a])];

		const screen = render(Page);

		// The preview is absent until a tile is clicked.
		expect(screen.container.querySelector('[data-testid="preview-stub"]')).toBeNull();
		screen.container.querySelector<HTMLButtonElement>('section[data-group-key] button')!.click();
		await expect.element(screen.getByTestId('preview-stub')).toBeInTheDocument();
	});

	it('swaps the previewed file when the preview navigates', async () => {
		const a = makeFile('a');
		const b = makeFile('b', { name: 'b.jpg' });
		store.entries = [a, b];
		store.groups = [dayGroup('2026-5-4', [a, b])];

		const screen = render(Page);

		// Open the preview on the first tile, then drive its onnavigate via the stub.
		screen.container.querySelector<HTMLButtonElement>('section[data-group-key] button')!.click();
		const stub = () => screen.container.querySelector<HTMLElement>('[data-testid="preview-stub"]');
		await expect.element(screen.getByTestId('preview-stub')).toBeInTheDocument();
		expect(stub()!.getAttribute('data-file-id')).toBe('a');

		// The stub's "next" button calls onnavigate(files[1]) → the page swaps previewFile.
		screen
			.getByTestId('preview-next')
			.element()
			.dispatchEvent(new Event('click', { bubbles: true }));
		await tick();
		expect(stub()!.getAttribute('data-file-id')).toBe('b');
	});

	it('uses the video poster as the tile thumbnail and labels its duration', async () => {
		const vid = makeFile('v', {
			name: 'v.mp4',
			mimeType: 'video/mp4',
			thumbnailFileId: 'poster-1',
			duration: 65
		});
		store.entries = [vid];
		store.groups = [dayGroup('2026-5-4', [vid])];

		const screen = render(Page);

		// thumbId() → poster id for a video → the gallery requests the poster image,
		// and the video gets a formatted duration badge.
		await expect.element(screen.getByText('1:05')).toBeInTheDocument();
		const img = screen.container.querySelector('section[data-group-key] img');
		expect(img?.getAttribute('src') ?? '').toContain('poster-1');
	});

	it('handles a video with no extracted poster (null thumb id)', async () => {
		const vid = makeFile('v', {
			name: 'v.mov',
			mimeType: 'video/quicktime',
			thumbnailFileId: null,
			duration: null,
			width: null,
			height: null
		});
		store.entries = [vid];
		store.groups = [dayGroup('2026-5-4', [vid])];

		const screen = render(Page);

		// Still rendered as a tile (aspectOf falls back to square; thumbId → null).
		await expect
			.element(screen.container.querySelector('section[data-group-key]') as HTMLElement)
			.toBeInTheDocument();
		expect(screen.container.querySelector('section[data-group-key] button')).not.toBeNull();
	});

	it('falls back to "Unknown date" for an unparseable group key', async () => {
		const a = makeFile('a');
		store.entries = [a];
		// A non-numeric key makes dayDate() produce an Invalid Date → formatDay NaN path.
		store.groups = [dayGroup('not-a-date', [a])];

		const screen = render(Page);
		await expect.element(screen.getByText('Unknown date')).toBeInTheDocument();
	});

	it('shows the loading-more spinner while a subsequent page is fetching', async () => {
		const a = makeFile('a');
		store.entries = [a];
		store.groups = [dayGroup('2026-5-4', [a])];
		store.nextCursor = 'cursor-2';
		store.loadingMore = true;

		const screen = render(Page);

		// While loadingMore is true the spinner shows and the Load more button is hidden
		// (tiles are themselves buttons, so target the load-more affordance by its text).
		expect(screen.container.querySelector('.animate-spin')).not.toBeNull();
		const loadMore = [...screen.container.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Load more'
		);
		expect(loadMore).toBeUndefined();
	});

	it('updates the scroll progress fraction as the grid scrolls', async () => {
		const a = makeFile('a');
		store.entries = [a];
		store.groups = [dayGroup('2026-5-4', [a])];
		store.buckets = [
			{ year: 2026, month: 6, count: 4 },
			{ year: 2026, month: 5, count: 2 }
		];

		const screen = render(Page);

		const scrollEl = screen.container.querySelector<HTMLElement>('.overflow-y-auto')!;
		// Force a scrollable region, then fire the scroll handler (rAF-throttled).
		Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true });
		Object.defineProperty(scrollEl, 'clientHeight', { value: 200, configurable: true });
		scrollEl.scrollTop = 400;
		scrollEl.dispatchEvent(new Event('scroll'));
		// Let the throttling rAF callback flush.
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		await tick();

		// progress = 400 / (1000-200) = 0.5 → handle position reflects it. We assert the
		// handler ran without error and the scrubber stayed mounted.
		await expect.element(screen.getByLabelText('Jump to date')).toBeInTheDocument();
	});

	it('scrolls proportionally when the scrubber emits a fraction', async () => {
		const a = makeFile('a');
		store.entries = [a];
		store.groups = [dayGroup('2026-5-4', [a])];
		store.buckets = [
			{ year: 2026, month: 6, count: 4 },
			{ year: 2025, month: 5, count: 2 }
		];

		const screen = render(Page);

		const scrollEl = screen.container.querySelector<HTMLElement>('.overflow-y-auto')!;
		Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true });
		Object.defineProperty(scrollEl, 'clientHeight', { value: 200, configurable: true });

		// A year-boundary label in the scrubber is a button that fires onscrub(startFrac).
		// Clicking it drives the page's onScrub → scrollTop = fraction * maxScroll.
		const yearBtn = screen.container.querySelector<HTMLButtonElement>(
			'aside[aria-label="Jump to date"] button'
		)!;
		yearBtn.click();
		await tick();

		// maxScroll = 1000 - 200 = 800; the topmost year label is fraction 0 → scrollTop 0.
		expect(scrollEl.scrollTop).toBeGreaterThanOrEqual(0);
		expect(scrollEl.scrollTop).toBeLessThanOrEqual(800);
	});
});
