import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useWaveformJob } from "~/composables/useWaveformJob";
import type { LibraryFile } from "~~/shared/types/api";

const generateWaveformFn = vi.fn();
const toastAdd = vi.fn();
const asyncJobStatusFn = vi.fn();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: {
    files: {
      generateWaveform: (...args: unknown[]) => generateWaveformFn(...args),
    },
  },
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => ({ add: toastAdd }),
}));

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
  };
}

describe("useWaveformJob", () => {
  beforeEach(() => {
    generateWaveformFn.mockReset();
    toastAdd.mockReset();
    asyncJobStatusFn.mockReset();
  });

  it("registers an async job watcher with waveformStatus + waveformError getters", () => {
    const file = ref<LibraryFile>(makeFile({ waveformStatus: "queued", waveformError: "boom" }));
    const refreshFile = vi.fn();
    useWaveformJob(ref("lib1"), ref("f1"), file, refreshFile);

    expect(asyncJobStatusFn).toHaveBeenCalledTimes(1);
    const cfg = asyncJobStatusFn.mock.calls[0]![0] as {
      statusGetter: () => string | null;
      errorGetter: () => string | null;
      pollFn: () => unknown;
      labels: Record<string, string>;
    };
    expect(cfg.statusGetter()).toBe("queued");
    expect(cfg.errorGetter()).toBe("boom");
    expect(cfg.labels).toEqual({ ready: "Waveform ready", failed: "Waveform failed" });
    expect(cfg.pollFn).toBe(refreshFile);
  });

  it("button label shifts with status: idle → in-flight → ready", async () => {
    const file = ref<LibraryFile>(makeFile({ waveformStatus: null }));
    const { button } = useWaveformJob(ref("lib1"), ref("f1"), file, vi.fn());
    expect(button.value.label).toBe("Generate waveform");

    file.value = { ...file.value, waveformStatus: "processing", waveformProgress: 42 };
    await nextTick();
    expect(button.value.label).toMatch(/42/);

    file.value = { ...file.value, waveformStatus: "ready", waveformProgress: 100 };
    await nextTick();
    expect(button.value.label).toBe("Regenerate waveform");

    file.value = { ...file.value, waveformStatus: "failed" };
    await nextTick();
    expect(button.value.label).toBe("Retry waveform");
  });

  it("run() calls API, replaces file with response, toasts info", async () => {
    const updated = makeFile({ waveformStatus: "queued" });
    generateWaveformFn.mockResolvedValue(updated);

    const file = ref<LibraryFile>(makeFile({ waveformStatus: null }));
    const { generating, run } = useWaveformJob(ref("lib1"), ref("f1"), file, vi.fn());

    expect(generating.value).toBe(false);
    const promise = run();
    expect(generating.value).toBe(true);
    await promise;

    expect(generateWaveformFn).toHaveBeenCalledWith("lib1", "f1");
    expect(file.value).toStrictEqual(updated);
    expect(toastAdd).toHaveBeenCalledWith({ title: "Waveform queued", color: "info" });
    expect(generating.value).toBe(false);
  });

  it("run() surfaces error toast and clears generating on failure", async () => {
    generateWaveformFn.mockRejectedValue(new Error("bad"));

    const file = ref<LibraryFile>(makeFile({ waveformStatus: null }));
    const { generating, run } = useWaveformJob(ref("lib1"), ref("f1"), file, vi.fn());

    await run();
    expect(toastAdd).toHaveBeenCalledWith({
      title: "Failed to queue waveform",
      color: "error",
    });
    expect(generating.value).toBe(false);
  });
});
