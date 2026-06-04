import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, nextTick, type App } from "vue";
import { withSetup } from "../support/with-setup";
import { fnStub } from "../support/fn-stub";
import { useTranscript } from "~/composables/useTranscript";
import type { LibraryFile } from "~~/shared/types/api";

const transcript = fnStub();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: () => Promise.resolve(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: { files: { transcript: (...a: unknown[]) => transcript(...a) } },
}));

function makeFile(over: Partial<LibraryFile>): LibraryFile {
  return {
    id: "f1",
    libraryId: "lib1",
    name: "clip.mp4",
    mimeType: "video/mp4",
    duration: 10,
    tags: [],
    ...over,
  } as LibraryFile;
}

const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello";

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

function mount(file: ReturnType<typeof ref<LibraryFile | null>>) {
  const { result, app: a } = withSetup(() => useTranscript(ref("lib1"), ref("f1"), file));
  app = a;
  return result;
}

describe("useTranscript", () => {
  beforeEach(() => transcript.reset());

  it("loads + parses the VTT when status is already ready (immediate)", async () => {
    transcript.resolve({ vtt: VTT });
    const { vtt, cues } = mount(ref<LibraryFile | null>(makeFile({ transcribeStatus: "ready" })));
    await nextTick();
    await Promise.resolve();
    expect(transcript.calls[0]).toEqual(["lib1", "f1"]);
    expect(vtt.value).toBe(VTT);
    expect(cues.value).toEqual([{ startSeconds: 1, endSeconds: 2, text: "hello" }]);
  });

  it("does not load when status is not ready, and cues stays empty", async () => {
    const { vtt, cues } = mount(
      ref<LibraryFile | null>(makeFile({ transcribeStatus: "processing" })),
    );
    await nextTick();
    expect(transcript.calls).toHaveLength(0);
    expect(vtt.value).toBeNull();
    expect(cues.value).toEqual([]);
  });

  it("clears the transcript when status leaves ready", async () => {
    transcript.resolve({ vtt: VTT });
    const file = ref<LibraryFile | null>(makeFile({ transcribeStatus: "ready" }));
    const { vtt } = mount(file);
    await nextTick();
    await Promise.resolve();
    expect(vtt.value).toBe(VTT);

    file.value = { ...file.value!, transcribeStatus: "processing" };
    await nextTick();
    expect(vtt.value).toBeNull();
  });

  it("refresh() returns null vtt when the file is missing", async () => {
    const { vtt, refresh } = mount(ref<LibraryFile | null>(null));
    await refresh();
    expect(transcript.calls).toHaveLength(0);
    expect(vtt.value).toBeNull();
  });

  it("refresh() swallows API errors and nulls the vtt", async () => {
    transcript.reject(new Error("boom"));
    const { vtt, refresh } = mount(ref<LibraryFile | null>(makeFile({ transcribeStatus: "ready" })));
    await refresh();
    expect(vtt.value).toBeNull();
  });

  it("handles a transcript response with no vtt field", async () => {
    transcript.resolve({});
    const { vtt, refresh } = mount(ref<LibraryFile | null>(makeFile({ transcribeStatus: "ready" })));
    await refresh();
    expect(vtt.value).toBeNull();
  });
});
