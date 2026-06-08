import type { Ref } from "vue";
import { apiFetch } from "~/utils/api-fetch";
import { useCursorList } from "~/composables/useCursorList";
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

  // Live-pushed activities (deduped by id) arrive via prependLive; the
  // WebSocket subscription is wired up by the page.
  const { loadFirst, loadMore, prependLive } = useCursorList<Activity, LibraryFeedResponse>({
    state: { entries, nextCursor, loading, loadingMore, error },
    fetchPage,
    getId: (activity) => activity.id,
  });

  return { entries, nextCursor, loading, loadingMore, error, loadFirst, loadMore, prependLive };
}
