import { ref, computed, watch, type Ref } from "vue";
import { api } from "~/api";
import type { LibraryFile, WaveformData } from "~~/shared/types/api";

/**
 * Loads waveform peak data for a file once its `waveformStatus` is "ready".
 * Clears when the status leaves "ready" or the file changes.
 */
export function useWaveform(
  libraryId: Ref<string>,
  fileId: Ref<string>,
  file: Ref<LibraryFile | null | undefined>,
) {
  const data = ref<WaveformData | null>(null);
  const peaks = computed(() => data.value?.peaks ?? null);
  const peaksPerSecond = computed(() => data.value?.peaksPerSecond ?? 50);

  async function refresh() {
    if (!file.value || file.value.waveformStatus !== "ready") {
      data.value = null;
      return;
    }
    try {
      data.value = await api.files.waveform(libraryId.value, fileId.value);
    } catch {
      data.value = null;
    }
  }

  watch(
    () => [file.value?.waveformStatus, file.value?.waveformedVersion],
    ([status]) => {
      if (status === "ready") void refresh();
      else data.value = null;
    },
    { immediate: true },
  );

  return { data, peaks, peaksPerSecond, refresh };
}
