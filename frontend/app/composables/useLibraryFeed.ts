import type { Ref } from "vue";
import { apiFetch } from "~/utils/api-fetch";
import type { Activity, LibraryFeedResponse } from "~~/shared/types/api";

interface UseLibraryFeedReturn {
  entries: Ref<Activity[]>;
  nextCursor: Ref<string | null>;
  loading: Ref<boolean>;
  loadingMore: Ref<boolean>;
  error: Ref<string | null>;
  loadFirst: () => Promise<void>;
  loadMore: () => Promise<void>;
  prependLive: (activity: Activity) => void;
}

/**
 * Per-library feed composable. Loads `/api/libraries/:id/feed` paginated
 * by cursor. Subscribes to live WebSocket events for the library when
 * `useNotificationsSocket` is connected (handled by the page).
 */
export function useLibraryFeed(libraryId: Ref<string> | string): UseLibraryFeedReturn {
  const idRef = computed(() => (typeof libraryId === "string" ? libraryId : libraryId.value));

  const entries = ref<Activity[]>([]);
  const nextCursor = ref<string | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);

  async function fetchPage(cursor?: string) {
    const query: Record<string, string | undefined> = {};
    if (cursor) query.cursor = cursor;
    return await apiFetch<LibraryFeedResponse>(`/api/libraries/${idRef.value}/feed`, { query });
  }

  async function loadFirst() {
    loading.value = true;
    error.value = null;
    try {
      const resp = await fetchPage();
      entries.value = resp.entries;
      nextCursor.value = resp.nextCursor;
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
      entries.value = entries.value.concat(resp.entries);
      nextCursor.value = resp.nextCursor;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loadingMore.value = false;
    }
  }

  // Insert a live-pushed activity at the top of the list, deduping by ID.
  function prependLive(activity: Activity) {
    if (entries.value.some((a) => a.id === activity.id)) return;
    entries.value = [activity, ...entries.value];
  }

  return { entries, nextCursor, loading, loadingMore, error, loadFirst, loadMore, prependLive };
}
