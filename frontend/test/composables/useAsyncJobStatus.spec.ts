import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, nextTick, type App } from "vue";
import { withSetup } from "../support/with-setup";
import { useAsyncJobStatus, type AsyncJobStatusOptions } from "~/composables/useAsyncJobStatus";
import type { JobStatus } from "~/utils/job-status-button";

const toastAdd = vi.fn();
vi.mock("~/composables/useToast", () => ({ useToast: () => ({ add: toastAdd }) }));

let app: App | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  toastAdd.mockReset();
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.useRealTimers();
});

function mount(opts: AsyncJobStatusOptions) {
  const { result, app: a } = withSetup(() => useAsyncJobStatus(opts));
  app = a;
  return result;
}

const LABELS = { ready: "Done", failed: "Boom" };

describe("useAsyncJobStatus", () => {
  it("polls on an interval while queued/processing", async () => {
    const status = ref<JobStatus>(null);
    const pollFn = vi.fn();
    mount({ statusGetter: () => status.value, pollFn, labels: LABELS });

    status.value = "processing";
    await nextTick();
    expect(pollFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(pollFn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(pollFn).toHaveBeenCalledTimes(2);
  });

  it("honors a custom intervalMs", async () => {
    const status = ref<JobStatus>(null);
    const pollFn = vi.fn();
    mount({ statusGetter: () => status.value, pollFn, labels: LABELS, intervalMs: 500 });

    status.value = "queued";
    await nextTick();
    vi.advanceTimersByTime(500);
    expect(pollFn).toHaveBeenCalledTimes(1);
  });

  it("does not double-start the timer across consecutive in-flight statuses", async () => {
    const status = ref<JobStatus>(null);
    const pollFn = vi.fn();
    mount({ statusGetter: () => status.value, pollFn, labels: LABELS });

    status.value = "queued";
    await nextTick();
    status.value = "processing";
    await nextTick();
    vi.advanceTimersByTime(2000);
    expect(pollFn).toHaveBeenCalledTimes(1);
  });

  it("stops polling, runs onReady, and toasts success on processing→ready", async () => {
    const status = ref<JobStatus>("processing");
    const pollFn = vi.fn();
    const onReady = vi.fn();
    mount({ statusGetter: () => status.value, pollFn, onReady, labels: LABELS });

    // trigger the watcher into the in-flight branch first
    status.value = "queued";
    await nextTick();
    vi.advanceTimersByTime(2000);
    expect(pollFn).toHaveBeenCalledTimes(1);

    status.value = "ready";
    await nextTick();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(toastAdd).toHaveBeenCalledWith({ title: "Done", color: "success" });

    pollFn.mockClear();
    vi.advanceTimersByTime(4000);
    expect(pollFn).not.toHaveBeenCalled();
  });

  it("toasts an error with the error description on processing→failed", async () => {
    const status = ref<JobStatus>(null);
    mount({
      statusGetter: () => status.value,
      errorGetter: () => "disk full",
      pollFn: vi.fn(),
      labels: LABELS,
    });

    status.value = "processing";
    await nextTick();
    status.value = "failed";
    await nextTick();
    expect(toastAdd).toHaveBeenCalledWith({
      title: "Boom",
      description: "disk full",
      color: "error",
    });
  });

  it("toasts a failure with undefined description when no errorGetter is given", async () => {
    const status = ref<JobStatus>(null);
    mount({ statusGetter: () => status.value, pollFn: vi.fn(), labels: LABELS });

    status.value = "queued";
    await nextTick();
    status.value = "failed";
    await nextTick();
    expect(toastAdd).toHaveBeenCalledWith({
      title: "Boom",
      description: undefined,
      color: "error",
    });
  });

  it("suppresses the toast when the status is already terminal on first observation", async () => {
    const status = ref<JobStatus>(null);
    const onReady = vi.fn();
    mount({ statusGetter: () => status.value, pollFn: vi.fn(), onReady, labels: LABELS });

    status.value = "ready"; // null → ready, never was in flight
    await nextTick();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it("clears the timer on unmount", async () => {
    const status = ref<JobStatus>(null);
    const pollFn = vi.fn();
    mount({ statusGetter: () => status.value, pollFn, labels: LABELS });

    status.value = "processing";
    await nextTick();
    app?.unmount();
    app = undefined;
    vi.advanceTimersByTime(6000);
    expect(pollFn).not.toHaveBeenCalled();
  });

  it("exposes a stop() that halts polling", async () => {
    const status = ref<JobStatus>(null);
    const pollFn = vi.fn();
    const { stop } = mount({ statusGetter: () => status.value, pollFn, labels: LABELS });

    status.value = "processing";
    await nextTick();
    stop();
    vi.advanceTimersByTime(6000);
    expect(pollFn).not.toHaveBeenCalled();
  });
});
