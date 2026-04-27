import { ref, computed, watch, onUnmounted, type Ref } from "vue";
import { api } from "~/api";
import type { Moment, MomentCreate, MomentPatch } from "~~/shared/types/api";

/**
 * Reactive moments for a given library+file.
 * Polls every 2s while any moment is queued/processing, then stops.
 */
export function useLibraryMoments(libraryId: Ref<string>, fileId: Ref<string>) {
  const moments = ref<Moment[]>([]);
  const loading = ref(false);
  const error = ref<unknown>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const hasInFlight = computed(() =>
    moments.value.some((m) => m.exportStatus === "queued" || m.exportStatus === "processing"),
  );

  async function refresh() {
    if (!libraryId.value || !fileId.value) return;
    loading.value = true;
    error.value = null;
    try {
      moments.value = await api.moments.list(libraryId.value, fileId.value);
    } catch (err) {
      error.value = err;
    } finally {
      loading.value = false;
    }
  }

  async function create(body: MomentCreate): Promise<Moment> {
    const created = await api.moments.create(libraryId.value, fileId.value, body);
    moments.value = [...moments.value, created].sort((a, b) => a.startSeconds - b.startSeconds);
    return created;
  }

  async function update(momentId: string, body: MomentPatch): Promise<Moment> {
    const updated = await api.moments.update(libraryId.value, fileId.value, momentId, body);
    moments.value = moments.value
      .map((m) => (m.id === momentId ? updated : m))
      .sort((a, b) => a.startSeconds - b.startSeconds);
    return updated;
  }

  async function remove(momentId: string): Promise<void> {
    await api.moments.delete(libraryId.value, fileId.value, momentId);
    moments.value = moments.value.filter((m) => m.id !== momentId);
  }

  async function syncTags(momentId: string, tagIds: string[]): Promise<Moment> {
    const updated = await api.moments.syncTags(libraryId.value, fileId.value, momentId, tagIds);
    moments.value = moments.value.map((m) => (m.id === momentId ? updated : m));
    return updated;
  }

  async function triggerExport(momentId: string): Promise<Moment> {
    const updated = await api.moments.export(libraryId.value, fileId.value, momentId);
    moments.value = moments.value.map((m) => (m.id === momentId ? updated : m));
    return updated;
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (!hasInFlight.value) {
        stopPolling();
        return;
      }
      refresh();
    }, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  watch(
    hasInFlight,
    (next) => {
      if (next) startPolling();
      else stopPolling();
    },
    { immediate: false },
  );

  watch(
    [libraryId, fileId],
    () => {
      refresh();
    },
    { immediate: true },
  );

  onUnmounted(stopPolling);

  return {
    moments,
    loading,
    error,
    hasInFlight,
    refresh,
    create,
    update,
    remove,
    syncTags,
    triggerExport,
  };
}
