import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useTranscribeJob } from "~/composables/useTranscribeJob";
import type { LibraryFile } from "~~/shared/types/api";

const transcribeFn = vi.fn();
const toastAdd = vi.fn();
const asyncJobStatusFn = vi.fn();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: { files: { transcribe: (...a: unknown[]) => transcribeFn(...a) } },
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

describe("useTranscribeJob", () => {
  beforeEach(() => {
    transcribeFn.mockReset();
    toastAdd.mockReset();
    asyncJobStatusFn.mockReset();
  });

  it("wires the async job watcher with transcribe status/error getters", () => {
    const file = ref(makeFile({ transcribeStatus: "queued", transcribeError: "bad" }));
    const refreshFile = vi.fn();
    useTranscribeJob(ref("lib1"), ref("f1"), file, refreshFile);

    const cfg = asyncJobStatusFn.mock.calls[0]![0] as {
      statusGetter: () => unknown;
      errorGetter: () => unknown;
      pollFn: () => unknown;
      labels: Record<string, string>;
    };
    expect(cfg.statusGetter()).toBe("queued");
    expect(cfg.errorGetter()).toBe("bad");
    expect(cfg.pollFn).toBe(refreshFile);
    expect(cfg.labels).toEqual({ ready: "Transcription ready", failed: "Transcription failed" });
  });

  it("shifts the button label across idle → progress → ready → failed", async () => {
    const file = ref(makeFile({ transcribeStatus: null }));
    const { button } = useTranscribeJob(ref("lib1"), ref("f1"), file, vi.fn());
    expect(button.value.label).toBe("Transcribe");

    file.value = { ...file.value, transcribeStatus: "processing", transcribeProgress: 7 };
    await nextTick();
    expect(button.value.label).toBe("Transcribing 7%");

    file.value = { ...file.value, transcribeStatus: "processing", transcribeProgress: null };
    await nextTick();
    expect(button.value.label).toBe("Transcribing…");

    file.value = { ...file.value, transcribeStatus: "ready" };
    await nextTick();
    expect(button.value.label).toBe("Retranscribe");

    file.value = { ...file.value, transcribeStatus: "failed" };
    await nextTick();
    expect(button.value.label).toBe("Retry transcribe");
  });

  it("run() queues transcription, swaps the file, and toasts info", async () => {
    const updated = makeFile({ transcribeStatus: "queued" });
    transcribeFn.mockResolvedValue(updated);
    const file = ref(makeFile({ transcribeStatus: null }));
    const { transcribing, run } = useTranscribeJob(ref("lib1"), ref("f1"), file, vi.fn());

    const p = run();
    expect(transcribing.value).toBe(true);
    await p;

    expect(transcribeFn).toHaveBeenCalledWith("lib1", "f1");
    expect(file.value).toStrictEqual(updated);
    expect(toastAdd).toHaveBeenCalledWith({ title: "Transcription queued", color: "info" });
    expect(transcribing.value).toBe(false);
  });

  it("run() toasts an error and clears transcribing on failure", async () => {
    transcribeFn.mockRejectedValue(new Error("nope"));
    const file = ref(makeFile({ transcribeStatus: null }));
    const { transcribing, run } = useTranscribeJob(ref("lib1"), ref("f1"), file, vi.fn());

    await run();
    expect(toastAdd).toHaveBeenCalledWith({
      title: "Failed to queue transcription",
      color: "error",
    });
    expect(transcribing.value).toBe(false);
  });
});
