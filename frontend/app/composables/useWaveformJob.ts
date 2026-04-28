import { ref, computed, type Ref } from "vue";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import { useAsyncJobStatus } from "~/composables/useAsyncJobStatus";
import { jobStatusButton } from "~/utils/job-status-button";
import type { LibraryFile } from "~~/shared/types/api";

/**
 * Triggers + tracks a file's waveform-generation job. Polls status while in
 * flight and surfaces toasts on terminal transitions. Provides a button
 * label/spec mirroring the transcribe-job pattern.
 */
export function useWaveformJob(
  libraryId: Ref<string>,
  fileId: Ref<string>,
  file: Ref<LibraryFile | null | undefined>,
  refreshFile: () => Promise<void> | void,
) {
  const toast = useToast();
  const generating = ref(false);

  useAsyncJobStatus({
    statusGetter: () => file.value?.waveformStatus ?? null,
    errorGetter: () => file.value?.waveformError ?? null,
    pollFn: refreshFile,
    labels: { ready: "Waveform ready", failed: "Waveform failed" },
  });

  const button = computed(() =>
    jobStatusButton(file.value?.waveformStatus ?? null, file.value?.waveformProgress ?? null, {
      idle: "Generate waveform",
      inFlight: "Generating waveform…",
      inFlightWithProgress: (p) => `Waveform ${p}%`,
      failed: "Retry waveform",
      ready: "Regenerate waveform",
    }),
  );

  async function run() {
    generating.value = true;
    try {
      const updated = await api.files.generateWaveform(libraryId.value, fileId.value);
      file.value = updated;
      toast.add({ title: "Waveform queued", color: "info" });
    } catch {
      toast.add({ title: "Failed to queue waveform", color: "error" });
    } finally {
      generating.value = false;
    }
  }

  return { generating, button, run };
}
