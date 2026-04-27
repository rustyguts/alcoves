import { computed, type Ref } from "vue";
import { useToast } from "~/composables/useToast";
import { useHighlightFilters, useHighlightMatches } from "~/composables/useHighlightFilters";
import type {
  AudioDetection,
  HighlightFilterCreate,
  HighlightFilterPatch,
} from "~~/shared/types/api";

/**
 * Editor-flavored facade over `useHighlightFilters` — same CRUD, plus the
 * matches/aggregates derivation against the file's audio detections + VTT,
 * with toast feedback wired in.
 */
export function useEditorHighlights(
  libraryId: Ref<string>,
  audioDetections: Ref<AudioDetection[]>,
  transcriptVtt: Ref<string | null>,
) {
  const toast = useToast();

  const { filters, loading, refresh, create, update, remove, loadPresets } =
    useHighlightFilters(libraryId);

  void refresh();

  const { matches, aggregates } = useHighlightMatches(filters, audioDetections, transcriptVtt);

  const hasSignals = computed(
    () => audioDetections.value.length > 0 || (transcriptVtt.value?.length ?? 0) > 0,
  );

  async function onCreate(body: HighlightFilterCreate) {
    try {
      await create(body);
      toast.add({ title: `Filter "${body.name}" added`, color: "success" });
    } catch {
      toast.add({ title: "Failed to add filter", color: "error" });
    }
  }

  async function onUpdate(id: string, body: HighlightFilterPatch) {
    try {
      await update(id, body);
    } catch {
      toast.add({ title: "Failed to update filter", color: "error" });
    }
  }

  async function onRemove(id: string) {
    try {
      await remove(id);
    } catch {
      toast.add({ title: "Failed to delete filter", color: "error" });
    }
  }

  async function onLoadPresets() {
    try {
      await loadPresets();
      toast.add({ title: "Presets loaded", color: "success" });
    } catch {
      toast.add({ title: "Failed to load presets", color: "error" });
    }
  }

  return {
    filters,
    loading,
    matches,
    aggregates,
    hasSignals,
    onCreate,
    onUpdate,
    onRemove,
    onLoadPresets,
  };
}
