import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useAudioDetectJob } from "~/composables/useAudioDetectJob";
import type { LibraryFile } from "~~/shared/types/api";

const audioDetectFn = vi.fn();
const toastAdd = vi.fn();
const asyncJobStatusFn = vi.fn();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: { files: { audioDetect: (...a: unknown[]) => audioDetectFn(...a) } },
}));

vi.mock("~/composables/useToast", () => ({ useToast: () => ({ add: toastAdd }) }));

vi.mock("~/composables/useAsyncJobStatus", () => ({
  useAsyncJobStatus: (cfg: unknown) => asyncJobStatusFn(cfg),
}));

function makeFile(over: Partial<LibraryFile>): LibraryFile {
  return {
    id: "f1",
    libraryId: "lib1",
    parentFolderId: null,
    name: "clip.mp4",
    mimeType: "video/mp4",
    size: 1,
    kind: "file",
    duration: 10,
    width: null,
    height: null,
    proxyStatus: null,
    sourceFileId: null,
    originalCreatedAt: null,
    hash: null,
    trashedAt: null,
    createdAt: "",
    updatedAt: "",
    owner: null,
    tags: [],
    ...over,
  } as LibraryFile;
}

describe("useAudioDetectJob", () => {
  beforeEach(() => {
    audioDetectFn.mockReset();
    toastAdd.mockReset();
    asyncJobStatusFn.mockReset();
  });

  it("wires the async job watcher with audioDetect status/error getters and onReady", () => {
    const file = ref(makeFile({ audioDetectStatus: "processing", audioDetectError: "boom" }));
    const refreshFile = vi.fn();
    const onReady = vi.fn();
    useAudioDetectJob(ref("lib1"), ref("f1"), file, refreshFile, onReady);

    const cfg = asyncJobStatusFn.mock.calls[0]![0] as {
      statusGetter: () => unknown;
      errorGetter: () => unknown;
      pollFn: () => unknown;
      onReady: () => unknown;
      labels: Record<string, string>;
    };
    expect(cfg.statusGetter()).toBe("processing");
    expect(cfg.errorGetter()).toBe("boom");
    expect(cfg.pollFn).toBe(refreshFile);
    expect(cfg.onReady).toBe(onReady);
    expect(cfg.labels).toEqual({
      ready: "Audio detection ready",
      failed: "Audio detection failed",
    });
  });

  it("shifts the button label across idle → progress → ready → failed", async () => {
    const file = ref(makeFile({ audioDetectStatus: null }));
    const { button } = useAudioDetectJob(ref("lib1"), ref("f1"), file, vi.fn(), vi.fn());
    expect(button.value.label).toBe("Detect sounds");

    file.value = { ...file.value, audioDetectStatus: "processing", audioDetectProgress: 42 };
    await nextTick();
    expect(button.value.label).toBe("Detecting 42%");

    file.value = { ...file.value, audioDetectStatus: "ready" };
    await nextTick();
    expect(button.value.label).toBe("Redetect");

    file.value = { ...file.value, audioDetectStatus: "failed" };
    await nextTick();
    expect(button.value.label).toBe("Retry detect");
  });

  it("run() queues detection, swaps the file, and toasts info", async () => {
    const updated = makeFile({ audioDetectStatus: "queued" });
    audioDetectFn.mockResolvedValue(updated);
    const file = ref(makeFile({ audioDetectStatus: null }));
    const { detecting, run } = useAudioDetectJob(ref("lib1"), ref("f1"), file, vi.fn(), vi.fn());

    expect(detecting.value).toBe(false);
    const p = run();
    expect(detecting.value).toBe(true);
    await p;

    expect(audioDetectFn).toHaveBeenCalledWith("lib1", "f1");
    expect(file.value).toStrictEqual(updated);
    expect(toastAdd).toHaveBeenCalledWith({ title: "Audio detection queued", color: "info" });
    expect(detecting.value).toBe(false);
  });

  it("run() toasts an error and clears detecting on failure", async () => {
    audioDetectFn.mockRejectedValue(new Error("nope"));
    const file = ref(makeFile({ audioDetectStatus: null }));
    const { detecting, run } = useAudioDetectJob(ref("lib1"), ref("f1"), file, vi.fn(), vi.fn());

    await run();
    expect(toastAdd).toHaveBeenCalledWith({
      title: "Failed to queue audio detection",
      color: "error",
    });
    expect(detecting.value).toBe(false);
  });
});
