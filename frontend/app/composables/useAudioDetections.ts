import { ref, watch, type Ref } from "vue";
import { api } from "~/api";
import type { AudioDetection, LibraryFile } from "~~/shared/types/api";

/**
 * Owns the audio-detections list for a file. Auto-refreshes on file id
 * change so a fresh `[fileId].vue` mount always loads the right data.
 */
export function useAudioDetections(
  libraryId: Ref<string>,
  fileId: Ref<string>,
  file: Ref<LibraryFile | null | undefined>,
) {
  const detections = ref<AudioDetection[]>([]);

  async function refresh() {
    try {
      const list = await api.files.audioDetections(libraryId.value, fileId.value);
      detections.value = list ?? [];
    } catch {
      detections.value = [];
    }
  }

  watch(
    () => file.value?.id,
    (id) => {
      if (id) void refresh();
    },
    { immediate: true },
  );

  return { detections, refresh };
}
