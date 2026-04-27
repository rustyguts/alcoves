import { watch, onBeforeUnmount } from "vue";
import { useToast } from "~/composables/useToast";
import type { JobStatus } from "~/utils/job-status-button";

export interface AsyncJobStatusOptions {
  statusGetter: () => JobStatus;
  errorGetter?: () => string | null | undefined;
  pollFn: () => void | Promise<void>;
  onReady?: () => void | Promise<void>;
  labels: { ready: string; failed: string };
  intervalMs?: number;
}

/**
 * Polls while a backend async job is queued/processing, fires toasts on
 * terminal transitions, and tears the timer down on unmount.
 *
 * The status itself is owned by the caller (typically a Ref derived from the
 * file record); this composable only reacts to it.
 */
export function useAsyncJobStatus(opts: AsyncJobStatusOptions) {
  const toast = useToast();
  const interval = opts.intervalMs ?? 2000;
  let timer: ReturnType<typeof setInterval> | null = null;

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void opts.pollFn();
    }, interval);
  }

  watch(opts.statusGetter, (status, prev) => {
    if (status === "queued" || status === "processing") {
      start();
      return;
    }
    stop();
    const wasInFlight = prev === "queued" || prev === "processing";
    if (status === "ready") {
      void opts.onReady?.();
    }
    // Suppress toast on initial load when status is already terminal.
    if (!wasInFlight) return;
    if (status === "ready") {
      toast.add({ title: opts.labels.ready, color: "success" });
    } else if (status === "failed") {
      toast.add({
        title: opts.labels.failed,
        description: opts.errorGetter?.() ?? undefined,
        color: "error",
      });
    }
  });

  onBeforeUnmount(stop);

  return { stop };
}
