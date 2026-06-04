import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ref, nextTick, type App } from "vue";
import { withSetup } from "../support/with-setup";
import { fnStub } from "../support/fn-stub";
import { useAudioDetections } from "~/composables/useAudioDetections";
import type { AudioDetection, LibraryFile } from "~~/shared/types/api";

const audioDetections = fnStub();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: () => Promise.resolve(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: { files: { audioDetections: (...a: unknown[]) => audioDetections(...a) } },
}));

function makeFile(over: Partial<LibraryFile>): LibraryFile {
  return { id: "f1", libraryId: "lib1", name: "c.mp4", tags: [], ...over } as LibraryFile;
}

const det: AudioDetection = {
  id: "d1",
  label: "Laughter",
  score: 0.7,
  startSeconds: 1,
  endSeconds: 2,
} as AudioDetection;

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

function mount(file: ReturnType<typeof ref<LibraryFile | null>>) {
  const { result, app: a } = withSetup(() => useAudioDetections(ref("lib1"), ref("f1"), file));
  app = a;
  return result;
}

describe("useAudioDetections", () => {
  beforeEach(() => audioDetections.reset());

  it("loads detections immediately when the file has an id", async () => {
    audioDetections.resolve([det]);
    const { detections } = mount(ref<LibraryFile | null>(makeFile({ id: "f1" })));
    await nextTick();
    await Promise.resolve();
    expect(audioDetections.calls[0]).toEqual(["lib1", "f1"]);
    expect(detections.value).toEqual([det]);
  });

  it("re-refreshes when the file id changes", async () => {
    audioDetections.resolve([det]);
    const file = ref<LibraryFile | null>(null);
    const { detections } = mount(file);
    await nextTick();
    expect(audioDetections.calls).toHaveLength(0);

    file.value = makeFile({ id: "f2" });
    await nextTick();
    await Promise.resolve();
    expect(audioDetections.calls).toHaveLength(1);
    expect(detections.value).toEqual([det]);
  });

  it("falls back to [] when the API returns nullish", async () => {
    audioDetections.resolve(null);
    const { detections, refresh } = mount(ref<LibraryFile | null>(makeFile({ id: "f1" })));
    await refresh();
    expect(detections.value).toEqual([]);
  });

  it("swallows API errors and resets to []", async () => {
    audioDetections.resolve([det]);
    const { detections, refresh } = mount(ref<LibraryFile | null>(makeFile({ id: "f1" })));
    await refresh();
    expect(detections.value).toEqual([det]);

    audioDetections.reject(new Error("boom"));
    await refresh();
    expect(detections.value).toEqual([]);
  });
});
