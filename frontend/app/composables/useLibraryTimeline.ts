import type { Ref } from "vue";
import { api } from "~/api";
import type { LibraryEntry, LibraryFile, PaginatedFiles } from "~~/shared/types/api";

export type TimelineType = "media" | "all";

/** Persisted across libraries — a single user preference, like the explorer's
 * entry-view mode. */
const TYPE_STORAGE_KEY = "alcoves.timeline.type";

export interface TimelineGroup {
  key: string;
  label: string;
  files: LibraryFile[];
}

/**
 * Timeline composable. Loads `/api/libraries/:id/timeline` paginated by a
 * capture-date keyset cursor and groups the flattened files into day buckets.
 * `type` toggles between media-only (default) and all files, persisted to
 * localStorage.
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

  function setType(t: TimelineType) {
    if (typeFilter.value === t) return;
    typeFilter.value = t;
    if (import.meta.client) localStorage.setItem(TYPE_STORAGE_KEY, t);
    void loadFirst();
  }

  // Entries arrive sorted newest-first by effective capture date, so building
  // contiguous day groups in order is correct.
  const groups = computed<TimelineGroup[]>(() => buildDateGroups(entries.value));

  return {
    entries,
    groups,
    nextCursor,
    totalCount,
    loading,
    loadingMore,
    error,
    typeFilter,
    loadFirst,
    loadMore,
    setType,
  };
}

function buildDateGroups(files: LibraryFile[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let current: TimelineGroup | null = null;
  for (const f of files) {
    const iso = f.capturedAt ?? f.createdAt;
    const d = new Date(iso);
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
