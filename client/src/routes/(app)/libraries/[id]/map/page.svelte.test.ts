import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryFile, MapPoint } from '$lib/types/api';

// --- Route state -----------------------------------------------------------
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1' },
		url: new URL('http://localhost/libraries/lib-1/map'),
		data: { library: { id: 'lib-1', name: 'Family Photos' }, user: { id: 'u1' } }
	}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

// --- Map store -------------------------------------------------------------
// A controllable fake mirroring createLibraryMap's getter surface. Tests mutate
// the backing object before render to drive the page's loading/error/empty/map
// branches.
const store = vi.hoisted(() => {
	const s = {
		points: [] as MapPoint[],
		truncated: false,
		loading: false,
		error: null as string | null,
		load: vi.fn(async (_id: string) => {})
	};
	return s;
});

const createLibraryMap = vi.hoisted(() => vi.fn());

vi.mock('$lib/state/library-map.svelte', () => ({
	createLibraryMap: (...args: unknown[]) => {
		createLibraryMap(...args);
		return store;
	}
}));

// --- Typed API client ------------------------------------------------------
// onSelect / onNavigate refetch the full file via api.files.get before opening
// the lightbox; the page just needs the namespace to exist.
const apiFilesGet = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', () => ({
	api: { files: { get: (...a: unknown[]) => apiFilesGet(...a) } }
}));

// --- Heavy children --------------------------------------------------------
// LibraryMap dynamically imports Leaflet on mount and FilePreview pulls in
// image-proxy / fetch plumbing — swap both for lightweight Svelte stubs that
// forward the onselect/onnavigate callbacks so the test can drive the page's
// own handlers (onSelect/onNavigate) via real DOM clicks instead of pulling in
// Leaflet / playback plumbing.
vi.mock('$lib/components/LibraryMap.svelte', async () => {
	const Stub = (await import('./map-stub.svelte')).default;
	return { default: Stub };
});
vi.mock('$lib/components/FilePreview.svelte', async () => {
	const Stub = (await import('./preview-stub.svelte')).default;
	return { default: Stub };
});

import Page from './+page.svelte';

function makePoint(id: string, over: Partial<MapPoint> = {}): MapPoint {
	return {
		id,
		name: `${id}.jpg`,
		lat: 37.78,
		lon: -122.4,
		thumbnailFileId: null,
		capturedAt: '2026-06-04T12:00:00Z',
		...over
	};
}

function resetStore() {
	store.points = [];
	store.truncated = false;
	store.loading = false;
	store.error = null;
	store.load.mockClear();
	createLibraryMap.mockClear();
	apiFilesGet.mockReset();
}

beforeEach(() => {
	resetStore();
});

describe('library map page', () => {
	it('loads the map for the current library on mount', async () => {
		render(Page);
		expect(createLibraryMap).toHaveBeenCalledTimes(1);
		expect(store.load).toHaveBeenCalledTimes(1);
		expect(store.load).toHaveBeenCalledWith('lib-1');
	});

	it('always renders the Map header', async () => {
		const screen = render(Page);
		await expect.element(screen.getByRole('heading', { name: 'Map' })).toBeInTheDocument();
		await expect.element(screen.getByText('Where your photos were taken.')).toBeInTheDocument();
	});

	it('shows the loading spinner before any points arrive', async () => {
		store.loading = true;
		store.points = [];
		const screen = render(Page);
		// The spinner overlay is the only thing rendered in the body area.
		expect(screen.container.querySelector('.animate-spin')).not.toBeNull();
	});

	it('shows the error state when the store reports an error', async () => {
		store.error = 'boom';
		const screen = render(Page);
		await expect.element(screen.getByText('boom')).toBeInTheDocument();
	});

	it('shows the empty state when there are no geotagged photos', async () => {
		store.loading = false;
		store.points = [];
		const screen = render(Page);
		await expect.element(screen.getByText('No geotagged photos yet.')).toBeInTheDocument();
	});

	it('mounts the map container and shows the geotagged count when points exist', async () => {
		store.points = [makePoint('a'), makePoint('b')];
		const screen = render(Page);
		// The page wraps LibraryMap in its own absolutely-positioned overlay, only
		// rendered once there are points to plot.
		expect(screen.container.querySelector('.relative .absolute.inset-0')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="map-stub"]')).not.toBeNull();
		await expect.element(screen.getByText('2 geotagged')).toBeInTheDocument();
		// The empty/loading overlays are gone when points are present.
		expect(screen.container.textContent).not.toContain('No geotagged photos yet.');
	});

	it('shows a truncation warning when the server capped the point set', async () => {
		store.points = [makePoint('a')];
		store.truncated = true;
		const screen = render(Page);
		await expect
			.element(screen.getByText(/Showing the most recent 1 geotagged files/))
			.toBeInTheDocument();
	});

	it('hides the truncation warning when the point set is complete', async () => {
		store.points = [makePoint('a')];
		store.truncated = false;
		const screen = render(Page);
		expect(screen.container.textContent).not.toContain('Showing the most recent');
	});

	it('refetches the full file and opens the lightbox when a marker is selected', async () => {
		store.points = [makePoint('a'), makePoint('b')];
		const full = { id: 'a', name: 'a.jpg' } as unknown as LibraryFile;
		apiFilesGet.mockResolvedValue(full);

		const screen = render(Page);

		// No preview until a marker is clicked.
		expect(screen.container.querySelector('[data-testid="preview-stub"]')).toBeNull();

		const markers = screen.container.querySelectorAll('[data-testid="map-marker"]');
		expect(markers).toHaveLength(2);
		(markers[0] as HTMLButtonElement).click();
		await vi.waitFor(() => expect(apiFilesGet).toHaveBeenCalledWith('lib-1', 'a'));

		const preview = await vi.waitFor(() => {
			const el = screen.container.querySelector('[data-testid="preview-stub"]');
			if (!el) throw new Error('preview not open yet');
			return el as HTMLElement;
		});
		// previewOpen flips true and the refetched file id flows into FilePreview.
		expect(preview.getAttribute('data-open')).toBe('true');
		expect(preview.getAttribute('data-file-id')).toBe('a');
		// previewFiles is derived from every map point (one lightweight record each).
		expect(preview.getAttribute('data-count')).toBe('2');
	});

	it('swallows a failed file fetch on select and keeps the lightbox closed', async () => {
		store.points = [makePoint('a')];
		apiFilesGet.mockRejectedValue(new Error('gone'));

		const screen = render(Page);

		const marker = screen.container.querySelector(
			'[data-testid="map-marker"]'
		) as HTMLButtonElement;
		marker.click();
		await vi.waitFor(() => expect(apiFilesGet).toHaveBeenCalledWith('lib-1', 'a'));
		await tick();

		// The catch branch leaves previewFile null, so FilePreview never mounts.
		expect(screen.container.querySelector('[data-testid="preview-stub"]')).toBeNull();
	});

	it('refetches the full file on lightbox navigate', async () => {
		store.points = [makePoint('a'), makePoint('b')];
		apiFilesGet
			.mockResolvedValueOnce({ id: 'a', name: 'a.jpg' } as unknown as LibraryFile)
			.mockResolvedValueOnce({ id: 'b', name: 'b.jpg' } as unknown as LibraryFile);

		const screen = render(Page);

		(screen.container.querySelector('[data-testid="map-marker"]') as HTMLButtonElement).click();
		const preview = await vi.waitFor(() => {
			const el = screen.container.querySelector('[data-testid="preview-stub"]');
			if (!el) throw new Error('preview not open yet');
			return el as HTMLElement;
		});
		expect(preview.getAttribute('data-file-id')).toBe('a');

		// The lightbox emits a thin previewFiles record on next; onNavigate refetches it.
		(screen.container.querySelector('[data-testid="preview-next"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(apiFilesGet).toHaveBeenCalledWith('lib-1', 'b'));
		await vi.waitFor(() =>
			expect(
				screen.container.querySelector('[data-testid="preview-stub"]')!.getAttribute('data-file-id')
			).toBe('b')
		);
	});

	it('swallows a failed refetch on navigate and keeps the previous file', async () => {
		store.points = [makePoint('a'), makePoint('b')];
		apiFilesGet
			.mockResolvedValueOnce({ id: 'a', name: 'a.jpg' } as unknown as LibraryFile)
			.mockRejectedValueOnce(new Error('gone'));

		const screen = render(Page);

		(screen.container.querySelector('[data-testid="map-marker"]') as HTMLButtonElement).click();
		const preview = await vi.waitFor(() => {
			const el = screen.container.querySelector('[data-testid="preview-stub"]');
			if (!el) throw new Error('preview not open yet');
			return el as HTMLElement;
		});
		expect(preview.getAttribute('data-file-id')).toBe('a');

		(screen.container.querySelector('[data-testid="preview-next"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(apiFilesGet).toHaveBeenCalledTimes(2));
		await tick();

		// onNavigate's catch leaves previewFile unchanged.
		expect(
			screen.container.querySelector('[data-testid="preview-stub"]')!.getAttribute('data-file-id')
		).toBe('a');
	});
});
