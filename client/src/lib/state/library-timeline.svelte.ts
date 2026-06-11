import { browser } from '$app/environment';
import { api } from '$lib/api';
import type {
	LibraryEntry,
	LibraryFile,
	PaginatedFiles,
	TimelineHistogramBucket
} from '$lib/types/api';

export type TimelineType = 'media' | 'all';

/** Persisted across libraries — a single user preference, like the explorer's
 * entry-view mode. */
const TYPE_STORAGE_KEY = 'alcoves.timeline.type';

export interface TimelineGroup {
	key: string;
	label: string;
	files: LibraryFile[];
}

/** A per-month density bucket for the date scrubber, newest-first. */
export type TimelineBucket = TimelineHistogramBucket;

/**
 * Timeline rune store. Loads `/api/libraries/:id/timeline` paginated by a
 * capture-date keyset cursor and groups the flattened files into day buckets.
 * `type` toggles between media-only (default) and all files, persisted to
 * localStorage.
 *
 * Also loads a whole-library per-month histogram (`/timeline/histogram`) that
 * drives the date scrubber's density blips. The histogram fetch is best-effort:
 * on failure the scrubber falls back to buckets derived from the loaded pages.
 *
 * `getLibraryId` is a getter so the store tracks a reactive library id from the
 * consuming component (the Vue version took a `Ref<string> | string`). State is
 * exposed via getters so reactivity survives the function boundary; the
 * component calls `loadFirst()` from its own `onMount`/`$effect`.
 */
export function createLibraryTimeline(getLibraryId: () => string) {
	let entries = $state<LibraryFile[]>([]);
	let nextCursor = $state<string | null>(null);
	let totalCount = $state(0);
	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state<string | null>(null);
	let typeFilter = $state<TimelineType>('media');
	// Whole-library month histogram for the scrubber; null until loaded or when
	// the fetch failed (then we derive buckets from the loaded pages instead).
	let histogram = $state<TimelineBucket[] | null>(null);

	// Restore the persisted filter (client only — node tests run without a DOM).
	if (browser) {
		const saved = localStorage.getItem(TYPE_STORAGE_KEY);
		if (saved === 'all' || saved === 'media') typeFilter = saved;
	}

	function onlyFiles(list: LibraryEntry[]): LibraryFile[] {
		return list.filter((e): e is LibraryFile => e.kind === 'file');
	}

	async function fetchPage(cursor?: string): Promise<PaginatedFiles> {
		return await api.libraries.timeline(getLibraryId(), {
			type: typeFilter,
			...(cursor ? { cursor } : {})
		});
	}

	async function loadFirst() {
		loading = true;
		error = null;
		try {
			const resp = await fetchPage();
			entries = onlyFiles(resp.entries);
			nextCursor = resp.nextCursor;
			totalCount = resp.totalCount;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
		// Refresh the scrubber histogram alongside the first page (non-blocking,
		// never fatal — the page already rendered from the page fetch above).
		void loadHistogram();
	}

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const resp = await fetchPage(nextCursor);
			entries = entries.concat(onlyFiles(resp.entries));
			nextCursor = resp.nextCursor;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loadingMore = false;
		}
	}

	// Best-effort: a histogram failure must not break the timeline — we simply
	// fall back to client-derived buckets (see `buckets`).
	async function loadHistogram() {
		try {
			const resp = await api.libraries.timelineHistogram(getLibraryId(), { type: typeFilter });
			histogram = resp.buckets;
		} catch {
			histogram = null;
		}
	}

	function setType(t: TimelineType) {
		if (typeFilter === t) return;
		typeFilter = t;
		if (browser) localStorage.setItem(TYPE_STORAGE_KEY, t);
		void loadFirst();
	}

	// Entries arrive sorted newest-first by effective capture date, so building
	// contiguous day groups in order is correct.
	const groups = $derived<TimelineGroup[]>(buildDateGroups(entries));

	// Scrubber density buckets: prefer the whole-library histogram; fall back to
	// buckets derived from whatever pages are loaded so the rail still works
	// offline / before the histogram resolves.
	const buckets = $derived<TimelineBucket[]>(
		histogram && histogram.length > 0 ? histogram : deriveBuckets(entries)
	);

	return {
		get entries() {
			return entries;
		},
		get groups() {
			return groups;
		},
		get buckets() {
			return buckets;
		},
		get histogram() {
			return histogram;
		},
		get nextCursor() {
			return nextCursor;
		},
		get totalCount() {
			return totalCount;
		},
		get loading() {
			return loading;
		},
		get loadingMore() {
			return loadingMore;
		},
		get error() {
			return error;
		},
		get typeFilter() {
			return typeFilter;
		},
		loadFirst,
		loadMore,
		loadHistogram,
		setType
	};
}

/** Effective capture instant for grouping — mirrors the backend's
 * COALESCE(captured_at, original_created_at, created_at) so a tile lands under
 * the same day the server sorted it into. */
function effectiveDate(f: LibraryFile): string {
	return f.capturedAt ?? f.originalCreatedAt ?? f.createdAt;
}

function buildDateGroups(files: LibraryFile[]): TimelineGroup[] {
	const groups: TimelineGroup[] = [];
	let current: TimelineGroup | null = null;
	for (const f of files) {
		const d = new Date(effectiveDate(f));
		// Bucket by the photo's *UTC* wall-clock day. EXIF capture dates carry no
		// timezone and the server stores them as UTC, so grouping by UTC keeps a
		// photo on the day it was taken — and makes grouping deterministic instead
		// of shifting with the viewer's local timezone (off-by-one near midnight).
		const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
		if (!current || current.key !== key) {
			current = { key, label: formatDayHeading(d), files: [] };
			groups.push(current);
		}
		current.files.push(f);
	}
	return groups;
}

// Group loaded files into per-month buckets (newest-first) — the fallback for
// the scrubber when the histogram endpoint is unavailable.
function deriveBuckets(files: LibraryFile[]): TimelineBucket[] {
	const byKey = new Map<string, TimelineBucket>();
	for (const f of files) {
		const d = new Date(effectiveDate(f));
		if (Number.isNaN(d.getTime())) continue;
		const year = d.getUTCFullYear();
		const month = d.getUTCMonth() + 1; // 1-12, matching the backend histogram
		const key = `${year}-${month}`;
		const existing = byKey.get(key);
		if (existing) existing.count += 1;
		else byKey.set(key, { year, month, count: 1 });
	}
	return [...byKey.values()].sort((a, b) => b.year - a.year || b.month - a.month);
}

function formatDayHeading(d: Date): string {
	if (Number.isNaN(d.getTime())) return 'Unknown date';
	return d.toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});
}
