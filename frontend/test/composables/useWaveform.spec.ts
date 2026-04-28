import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useWaveform } from "~/composables/useWaveform";
import type { LibraryFile, WaveformData } from "~~/shared/types/api";

const waveformFn = vi.fn();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: {
    files: {
      waveform: (...args: unknown[]) => waveformFn(...args),
    },
  },
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

describe("useWaveform", () => {
  beforeEach(() => {
    waveformFn.mockReset();
  });

  it("does not fetch when status is not ready", async () => {
    const file = ref<LibraryFile>(makeFile({ waveformStatus: "queued" }));
    const { peaks } = useWaveform(ref("lib1"), ref("f1"), file);
    await nextTick();
    expect(waveformFn).not.toHaveBeenCalled();
    expect(peaks.value).toBe(null);
  });

  it("fetches when status flips to ready and exposes peaks", async () => {
    const data: WaveformData = { peaks: [0.1, 0.5], peaksPerSecond: 50 };
    waveformFn.mockResolvedValue(data);

    const file = ref<LibraryFile>(makeFile({ waveformStatus: null }));
    const { peaks, peaksPerSecond } = useWaveform(ref("lib1"), ref("f1"), file);
    await nextTick();
    expect(waveformFn).not.toHaveBeenCalled();

    file.value = { ...file.value, waveformStatus: "ready" };
    await nextTick();
    await nextTick();
    expect(waveformFn).toHaveBeenCalledWith("lib1", "f1");
    expect(peaks.value).toEqual([0.1, 0.5]);
    expect(peaksPerSecond.value).toBe(50);
  });

  it("clears peaks when status leaves ready", async () => {
    waveformFn.mockResolvedValue({ peaks: [0.9], peaksPerSecond: 50 });
    const file = ref<LibraryFile>(makeFile({ waveformStatus: "ready" }));
    const { peaks } = useWaveform(ref("lib1"), ref("f1"), file);
    await nextTick();
    await nextTick();
    expect(peaks.value).toEqual([0.9]);

    file.value = { ...file.value, waveformStatus: "failed" };
    await nextTick();
    expect(peaks.value).toBe(null);
  });

  it("swallows fetch errors and leaves peaks null", async () => {
    waveformFn.mockRejectedValue(new Error("boom"));
    const file = ref<LibraryFile>(makeFile({ waveformStatus: "ready" }));
    const { peaks } = useWaveform(ref("lib1"), ref("f1"), file);
    await nextTick();
    await nextTick();
    expect(peaks.value).toBe(null);
  });
});
