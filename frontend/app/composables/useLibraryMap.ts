import type { Ref } from "vue";
import { api } from "~/api";
import type { MapPoint } from "~~/shared/types/api";

/**
 * Map composable. Loads all geotagged files for a library in one shot via
 * `/api/libraries/:id/map`. `truncated` is true when the server-side point cap
 * was hit.
 */
export function useLibraryMap(libraryId: Ref<string> | string) {
  const idRef = computed(() => (typeof libraryId === "string" ? libraryId : libraryId.value));

  const points = ref<MapPoint[]>([]);
  const truncated = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const resp = await api.libraries.map(idRef.value);
      points.value = resp.points;
      truncated.value = resp.truncated;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  return { points, truncated, loading, error, load };
}
