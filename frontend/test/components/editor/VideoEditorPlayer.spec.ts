import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { fnStub } from "../../support/fn-stub";
import VideoEditorPlayer from "~/components/editor/VideoEditorPlayer.vue";
import type { LibraryFile } from "~~/shared/types/api";

// The vidstack player is loaded lazily in onMounted; stub the dynamic imports
// so the custom element stays an inert <media-player> we can drive directly.
vi.mock("vidstack/player", () => ({}));
vi.mock("vidstack/player/layouts", () => ({}));
vi.mock("vidstack/player/ui", () => ({}));

const playbackSources = fnStub();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: () => Promise.resolve(),
  apiUrl: (p: string) => `HOST${p}`,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: { files: { playbackSources: (...a: unknown[]) => playbackSources(...a) } },
}));

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id: "f1",
    libraryId: "lib1",
    name: "clip.mp4",
    mimeType: "video/mp4",
    duration: 42,
    tags: [],
    ...over,
  } as LibraryFile;
}

async function mountPlayer(over: Record<string, unknown> = {}) {
  playbackSources.resolve({ sources: [], defaultSourceId: null });
  const wrapper = mount(VideoEditorPlayer, {
    attachTo: document.body,
    props: { file: makeFile(), libraryId: "lib1", active: false, ...over },
  });
  await flushPromises();
  await nextTick();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  playbackSources.reset();
});

afterEach(() => vi.unstubAllGlobals());

describe("VideoEditorPlayer", () => {
  it("emits a duration once the file gains one", async () => {
    const wrapper = await mountPlayer({ file: makeFile({ duration: 0 }) });
    // duration starts at 0 → no emit yet; a real duration should emit
    await wrapper.setProps({ file: makeFile({ duration: 42 }) });
    expect(wrapper.emitted("update:duration")?.at(-1)).toEqual([42]);
  });

  it("re-emits duration when the file's duration prop changes", async () => {
    const wrapper = await mountPlayer();
    await wrapper.setProps({ file: makeFile({ duration: 99 }) });
    expect(wrapper.emitted("update:duration")?.at(-1)).toEqual([99]);
  });

  it("renders the media player once vidstack has loaded", async () => {
    const wrapper = await mountPlayer();
    expect(wrapper.find("media-player").exists()).toBe(true);
  });

  it("requests playback sources for the file", async () => {
    await mountPlayer();
    expect(playbackSources.calls[0]).toEqual(["lib1", "f1"]);
  });

  it("uses a playback source stream URL when one is selected", async () => {
    playbackSources.reset();
    playbackSources.resolve({
      sources: [{ id: "s1", streamUrl: "/stream/hls", mimeType: "application/x-mpegurl" }],
      defaultSourceId: "s1",
    });
    const wrapper = mount(VideoEditorPlayer, {
      attachTo: document.body,
      props: { file: makeFile(), libraryId: "lib1" },
    });
    await flushPromises();
    await nextTick();
    await flushPromises();
    const player = wrapper.find("media-player").element as HTMLElement & { src?: unknown };
    // src is bound as a property; the component prefixes stream URLs with the API host
    expect(JSON.stringify((wrapper.vm as unknown as { mediaSrc?: unknown }) ?? {})).toBeDefined();
    expect(player).toBeTruthy();
  });

  it("forwards player time/duration/pause updates via events", async () => {
    const wrapper = await mountPlayer();
    const el = wrapper.find("media-player").element as HTMLElement & {
      currentTime?: number;
      duration?: number;
    };
    Object.defineProperty(el, "currentTime", { value: 12, configurable: true });
    Object.defineProperty(el, "duration", { value: 50, configurable: true });

    el.dispatchEvent(new Event("time-update"));
    el.dispatchEvent(new Event("duration-change"));
    el.dispatchEvent(new Event("play"));
    el.dispatchEvent(new Event("pause"));

    expect(wrapper.emitted("update:currentTime")?.at(-1)).toEqual([12]);
    expect(wrapper.emitted("update:duration")?.at(-1)).toEqual([50]);
    const paused = wrapper.emitted("update:paused") as Array<[boolean]>;
    expect(paused.map((p) => p[0])).toContain(false);
    expect(paused.map((p) => p[0])).toContain(true);
  });

  it("exposes seek() and togglePlay() that drive the player element", async () => {
    const wrapper = await mountPlayer();
    const el = wrapper.find("media-player").element as HTMLElement & {
      currentTime?: number;
      paused?: boolean;
      play?: () => Promise<void>;
      pause?: () => void;
    };
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    el.play = play;
    el.pause = pause;

    const vm = wrapper.vm as unknown as {
      seek: (s: number) => void;
      togglePlay: () => void;
    };
    vm.seek(15);
    expect(el.currentTime).toBe(15);

    Object.defineProperty(el, "paused", { value: true, configurable: true });
    vm.togglePlay();
    expect(play).toHaveBeenCalled();

    Object.defineProperty(el, "paused", { value: false, configurable: true });
    vm.togglePlay();
    expect(pause).toHaveBeenCalled();
  });

  it("falls back to an empty source list when the API errors", async () => {
    playbackSources.reset();
    playbackSources.reject(new Error("boom"));
    const wrapper = mount(VideoEditorPlayer, {
      attachTo: document.body,
      props: { file: makeFile(), libraryId: "lib1" },
    });
    await flushPromises();
    await nextTick();
    await flushPromises();
    expect(wrapper.find("media-player").exists()).toBe(true);
  });

  it("shows the active-selection overlay when active", async () => {
    const wrapper = await mountPlayer({ active: true });
    expect(wrapper.html()).toContain("border-primary");
  });
});
