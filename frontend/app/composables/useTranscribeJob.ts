import { ref, computed, type Ref } from "vue";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import { useAsyncJobStatus } from "~/composables/useAsyncJobStatus";
import { jobStatusButton } from "~/utils/job-status-button";
import type { LibraryFile } from "~~/shared/types/api";

/**
 * Triggers + tracks a file's transcription job. Polls status while in
 * flight and surfaces toasts on terminal transitions.
 */
export function useTranscribeJob(
  libraryId: Ref<string>,
  fileId: Ref<string>,
  file: Ref<LibraryFile | null | undefined>,
  refreshFile: () => Promise<void> | void,
) {
  const toast = useToast();
  const transcribing = ref(false);

  useAsyncJobStatus({
    statusGetter: () => file.value?.transcribeStatus ?? null,
    errorGetter: () => file.value?.transcribeError ?? null,
    pollFn: refreshFile,
    labels: { ready: "Transcription ready", failed: "Transcription failed" },
  });

  const button = computed(() =>
    jobStatusButton(file.value?.transcribeStatus ?? null, file.value?.transcribeProgress ?? null, {
      idle: "Transcribe",
      inFlight: "Transcribing…",
      inFlightWithProgress: (p) => `Transcribing ${p}%`,
      failed: "Retry transcribe",
      ready: "Retranscribe",
    }),
  );

  async function run() {
    transcribing.value = true;
    try {
      const updated = await api.files.transcribe(libraryId.value, fileId.value);
      file.value = updated;
      toast.add({ title: "Transcription queued", color: "info" });
    } catch {
      toast.add({ title: "Failed to queue transcription", color: "error" });
    } finally {
      transcribing.value = false;
    }
  }

  return { transcribing, button, run };
}
