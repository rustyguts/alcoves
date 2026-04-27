import { ref, computed, type Ref } from "vue";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import { useAsyncJobStatus } from "~/composables/useAsyncJobStatus";
import { jobStatusButton } from "~/utils/job-status-button";
import type { LibraryFile } from "~~/shared/types/api";

/**
 * Triggers + tracks a file's audio-event detection job. Polls status while
 * in flight, surfaces toasts on terminal transitions, and refreshes the
 * detections list when the job becomes ready.
 */
export function useAudioDetectJob(
  libraryId: Ref<string>,
  fileId: Ref<string>,
  file: Ref<LibraryFile | null | undefined>,
  refreshFile: () => Promise<void> | void,
  onReady: () => Promise<void> | void,
) {
  const toast = useToast();
  const detecting = ref(false);

  useAsyncJobStatus({
    statusGetter: () => file.value?.audioDetectStatus ?? null,
    errorGetter: () => file.value?.audioDetectError ?? null,
    pollFn: refreshFile,
    onReady,
    labels: { ready: "Audio detection ready", failed: "Audio detection failed" },
  });

  const button = computed(() =>
    jobStatusButton(
      file.value?.audioDetectStatus ?? null,
      file.value?.audioDetectProgress ?? null,
      {
        idle: "Detect sounds",
        inFlight: "Detecting…",
        inFlightWithProgress: (p) => `Detecting ${p}%`,
        failed: "Retry detect",
        ready: "Redetect",
      },
    ),
  );

  async function run() {
    detecting.value = true;
    try {
      const updated = await api.files.audioDetect(libraryId.value, fileId.value);
      file.value = updated;
      toast.add({ title: "Audio detection queued", color: "info" });
    } catch {
      toast.add({ title: "Failed to queue audio detection", color: "error" });
    } finally {
      detecting.value = false;
    }
  }

  return { detecting, button, run };
}
