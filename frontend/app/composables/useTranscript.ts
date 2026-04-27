import { ref, computed, watch, type Ref } from "vue";
import { api } from "~/api";
import { parseVtt, type VttCue } from "~/utils/parse-vtt";
import type { LibraryFile } from "~~/shared/types/api";

/**
 * Loads + parses the transcript VTT for a file once its `transcribeStatus`
 * goes "ready". Clears when the status leaves "ready" or the file changes.
 */
export function useTranscript(
  libraryId: Ref<string>,
  fileId: Ref<string>,
  file: Ref<LibraryFile | null | undefined>,
) {
  const vtt = ref<string | null>(null);
  const cues = computed<VttCue[]>(() => parseVtt(vtt.value));

  async function refresh() {
    if (!file.value || file.value.transcribeStatus !== "ready") {
      vtt.value = null;
      return;
    }
    try {
      const r = await api.files.transcript(libraryId.value, fileId.value);
      vtt.value = r?.vtt ?? null;
    } catch {
      vtt.value = null;
    }
  }

  watch(
    () => file.value?.transcribeStatus,
    (status) => {
      if (status === "ready") void refresh();
      else vtt.value = null;
    },
    { immediate: true },
  );

  return { vtt, cues, refresh };
}
