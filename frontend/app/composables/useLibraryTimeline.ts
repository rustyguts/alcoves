import type { Ref } from "vue";
import { api } from "~/api";
import type {
  LibraryEntry,
  LibraryFile,
  PaginatedFiles,
  TimelineHistogramBucket,
} from "~~/shared/types/api";

export type TimelineType = "media" | "all";

/** Persisted across libraries — a single user preference, like the explorer's
 * entry-view mode. */
const TYPE_STORAGE_KEY = "alcoves.timeline.type";

export interface TimelineGroup {
  key: string;
  label: string;
  files: LibraryFile[];
}

/** A per-month density bucket for the date scrubber, newest-first. */
export type TimelineBucket = TimelineHistogramBucket;

/**
 * Timeline composable. Loads `/api/libraries/:id/timeline` paginated by a
 * capture-date keyset cursor and groups the flattened files into day buckets.
 * `type` toggles between media-only (default) and all files, persisted to
 * localStorage.
 *
 * Also loads a whole-library per-month histogram (`/timeline/histogram`) that
 * drives the date scrubber's density blips. The histogram fetch is best-effort:
 * on failure the scrubber falls back to buckets derived from the loaded pages.
 */
export function useLibraryTimeline(libraryId: Ref<string> | string) {
  const idRef = computed(() => (typeof libraryId === "string" ? libraryId : libraryId.value));

  const entries = ref<LibraryFile[]>([]);
  const nextCursor = ref<string | null>(null);
  const totalCount = ref(0);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  const typeFilter = ref<TimelineType>("media");
  // Whole-library month histogram for the scrubber; null until loaded or when
  // the fetch failed (then we derive buckets from the loaded pages instead).
  const histogram = ref<TimelineBucket[] | null>(null);

  // Restore the persisted filter (client only — pages are SSR-safe).
  if (import.meta.client) {
    const saved = localStorage.getItem(TYPE_STORAGE_KEY);
    if (saved === "all" || saved === "media") typeFilter.value = saved;
  }

  function onlyFiles(list: LibraryEntry[]): LibraryFile[] {
    return list.filter((e): e is LibraryFile => e.kind === "file");
  }

  async function fetchPage(cursor?: string): Promise<PaginatedFiles> {
    return await api.libraries.timeline(idRef.value, {
      type: typeFilter.value,
      ...(cursor ? { cursor } : {}),
    });
  }

  async function loadFirst() {
    loading.value = true;
    error.value = null;
    try {
      const resp = await fetchPage();
      entries.value = onlyFiles(resp.entries);
      nextCursor.value = resp.nextCursor;
      totalCount.value = resp.totalCount;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
    // Refresh the scrubber histogram alongside the first page (non-blocking,
    // never fatal — the page already rendered from the page fetch above).
    void loadHistogram();
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
      const resp = await fetchPage(nextCursor.value);
      entries.value = entries.value.concat(onlyFiles(resp.entries));
      nextCursor.value = resp.nextCursor;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loadingMore.value = false;
    }
  }

  // Best-effort: a histogram failure must not break the timeline — we simply
  // fall back to client-derived buckets (see `buckets`).
  async function loadHistogram() {
    try {
      const resp = await api.libraries.timelineHistogram(idRef.value, { type: typeFilter.value });
      histogram.value = resp.buckets;
    } catch {
      histogram.value = null;
    }
  }

  function setType(t: TimelineType) {
    if (typeFilter.value === t) return;
    typeFilter.value = t;
    if (import.meta.client) localStorage.setItem(TYPE_STORAGE_KEY, t);
    void loadFirst();
  }

  // Entries arrive sorted newest-first by effective capture date, so building
  // contiguous day groups in order is correct.
  const groups = computed<TimelineGroup[]>(() => buildDateGroups(entries.value));

  // Scrubber density buckets: prefer the whole-library histogram; fall back to
  // buckets derived from whatever pages are loaded so the rail still works
  // offline / before the histogram resolves.
  const buckets = computed<TimelineBucket[]>(() =>
    histogram.value && histogram.value.length > 0
      ? histogram.value
      : deriveBuckets(entries.value),
  );

  return {
    entries,
    groups,
    buckets,
    histogram,
    nextCursor,
    totalCount,
    loading,
    loadingMore,
    error,
    typeFilter,
    loadFirst,
    loadMore,
    loadHistogram,
    setType,
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
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
