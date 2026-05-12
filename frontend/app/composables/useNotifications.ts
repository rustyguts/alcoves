import type { Ref } from "vue";
import { apiFetch } from "~/utils/api-fetch";
import type { Activity, NotificationsResponse, UnreadCountResponse } from "~~/shared/types/api";

interface UseNotificationsReturn {
  entries: Ref<Activity[]>;
  unreadCount: Ref<number>;
  nextCursor: Ref<string | null>;
  loading: Ref<boolean>;
  loadingMore: Ref<boolean>;
  error: Ref<string | null>;
  loadFirst: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  dismiss: (activityId: string) => Promise<void>;
  dismissAll: () => Promise<void>;
  prependLive: (activity: Activity) => void;
}

/**
 * Global bell composable. Uses Nuxt `useState` so the bell badge and the
 * /notifications page share the same reactive state across navigations.
 */
export function useNotifications(): UseNotificationsReturn {
  const entries = useState<Activity[]>("notifications:entries", () => []);
  const unreadCount = useState<number>("notifications:unread", () => 0);
  const nextCursor = useState<string | null>("notifications:cursor", () => null);
  const loading = useState<boolean>("notifications:loading", () => false);
  const loadingMore = useState<boolean>("notifications:loadingMore", () => false);
  const error = useState<string | null>("notifications:error", () => null);

  async function fetchPage(cursor?: string) {
    const query: Record<string, string | undefined> = {};
    if (cursor) query.cursor = cursor;
    return await apiFetch<NotificationsResponse>("/api/notifications", { query });
  }

  async function loadFirst() {
    loading.value = true;
    error.value = null;
    try {
      const resp = await fetchPage();
      entries.value = resp.entries;
      nextCursor.value = resp.nextCursor;
      unreadCount.value = resp.unreadCount;
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
      unreadCount.value = resp.unreadCount;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loadingMore.value = false;
    }
  }

  async function refreshUnreadCount() {
    try {
      const resp = await apiFetch<UnreadCountResponse>("/api/notifications/unread-count");
      unreadCount.value = resp.unreadCount;
    } catch {
      // ignore — polling fallback can fail transiently
    }
  }

  async function dismiss(activityId: string) {
    // Optimistic: remove locally, decrement count, then call API.
    const idx = entries.value.findIndex((a) => a.id === activityId);
    if (idx >= 0) {
      entries.value = entries.value.filter((_, i) => i !== idx);
    }
    if (unreadCount.value > 0) unreadCount.value = unreadCount.value - 1;
    try {
      await apiFetch<void>(`/api/notifications/${activityId}/dismiss`, { method: "POST" });
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  async function dismissAll() {
    entries.value = [];
    unreadCount.value = 0;
    try {
      await apiFetch<void>("/api/notifications/dismiss-all", { method: "POST" });
    } catch (e) {
      error.value = (e as Error).message;
    }
  }

  function prependLive(activity: Activity) {
    if (entries.value.some((a) => a.id === activity.id)) return;
    entries.value = [activity, ...entries.value];
    unreadCount.value = unreadCount.value + 1;
  }

  return {
    entries,
    unreadCount,
    nextCursor,
    loading,
    loadingMore,
    error,
    loadFirst,
    loadMore,
    refreshUnreadCount,
    dismiss,
    dismissAll,
    prependLive,
  };
}
