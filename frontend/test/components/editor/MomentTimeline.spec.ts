import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MomentTimeline from "~/components/editor/MomentTimeline.vue";
import type { Moment } from "~~/shared/types/api";

// The waveform renderer has its own test; stub it so the canvas 2D context
// isn't required here and we exercise only MomentTimeline's own logic.
vi.mock("~/composables/useWaveformRenderer", () => ({ useWaveformRenderer: () => {} }));

let roCallback: (() => void) | null = null;
class FakeResizeObserver {
  constructor(cb: () => void) {
    roCallback = cb;
  }
  observe() {}
  disconnect() {}
}

function makeMoment(over: Partial<Moment>): Moment {
  return {
    id: "m1",
    libraryId: "lib1",
    fileId: "file1",
    name: "Clip",
    startSeconds: 0,
    endSeconds: 10,
    exportStatus: null,
    exportProgress: null,
    exportVersion: 1,
    exportedVersion: null,
    tags: [],
    ...over,
  } as Moment;
}

const CONTAINER_WIDTH = 1000;

function mountTimeline(over: Record<string, unknown> = {}) {
  const wrapper = mount(MomentTimeline, {
    attachTo: document.body,
    props: {
      duration: 100,
      currentTime: 10,
      moments: [makeMoment({ id: "m1", startSeconds: 10, endSeconds: 40 })],
      selectedId: null,
      ...over,
    },
  });
  // Give the scroll container a measurable width so pxPerSec > 0.
  const scrollEl = wrapper.find(".timeline-scroll").element as HTMLElement;
  Object.defineProperty(scrollEl, "clientWidth", { value: CONTAINER_WIDTH, configurable: true });
  roCallback?.();
  return wrapper;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  roCallback = null;
});

afterEach(() => {
  // A completed drag installs a one-shot capture-phase click suppressor on
  // window; flush any that a test left behind so they don't eat the next
  // test's first click.
  window.dispatchEvent(new MouseEvent("click"));
  vi.unstubAllGlobals();
});

describe("MomentTimeline", () => {
  it("renders the time readout and zoom percent", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    expect(wrapper.text()).toContain("0:10 / 1:40");
    expect(wrapper.text()).toContain("100%");
  });

  it("emits create-moment and open-shortcuts from the toolbar", async () => {
    const wrapper = mountTimeline();
    await wrapper.findAll("button").find((b) => b.text().includes("New moment"))!.trigger("click");
    await wrapper.find("[data-icon='i-lucide-keyboard']").trigger("click");
    expect(wrapper.emitted("create-moment")).toHaveLength(1);
    expect(wrapper.emitted("open-shortcuts")).toHaveLength(1);
  });

  it("seeks when the track is clicked", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    await wrapper.find("[role='slider']").trigger("click", { clientX: 500 });
    const seek = wrapper.emitted("seek");
    expect(seek).toBeTruthy();
    // x=500 over innerWidth 1000 → 50% of duration 100
    expect(seek!.at(-1)).toEqual([50]);
  });

  it("seeks when the ruler is clicked", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    await wrapper.find(".h-5").trigger("click", { clientX: 250 });
    expect(wrapper.emitted("seek")?.at(-1)).toEqual([25]);
  });

  it("selects a moment when its bar is clicked", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    await wrapper.find(".group").trigger("click");
    expect(wrapper.emitted("select-moment")?.at(-1)).toEqual(["m1"]);
  });

  it("zooms in and out with the keyboard", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
    await nextTick();
    expect(wrapper.text()).toContain("150%");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    await nextTick();
    expect(wrapper.text()).toContain("100%");
  });

  it("ignores keyboard shortcuts while typing in a field", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    await nextTick();
    expect(wrapper.text()).toContain("100%");
    input.remove();
  });

  it("drags a moment body to create a pending change and saves it", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    const bar = wrapper.find(".group");
    await bar.trigger("mousedown", { clientX: 0 });
    expect(wrapper.emitted("select-moment")?.at(-1)).toEqual(["m1"]);

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    await nextTick();
    window.dispatchEvent(new MouseEvent("mouseup"));
    await nextTick();
    // onDragEnd installs a one-shot capture click suppressor (to swallow the
    // click that follows a drag); consume it so it doesn't eat the Save click.
    window.dispatchEvent(new MouseEvent("click"));

    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("Save changes"));
    expect(saveBtn!.attributes("disabled")).toBeUndefined();
    await saveBtn!.trigger("click");

    const saved = wrapper.emitted("save-pending");
    expect(saved).toHaveLength(1);
    const changes = saved![0]![0] as Array<{ id: string; startSeconds: number; endSeconds: number }>;
    expect(changes[0]!.id).toBe("m1");
    // moved 50px / 10px-per-sec = +5s on a [10,40] window
    expect(changes[0]!.startSeconds).toBeCloseTo(15);
    expect(changes[0]!.endSeconds).toBeCloseTo(45);
  });

  it("resizes a moment via the start handle", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    const handles = wrapper.findAll(".cursor-ew-resize");
    await handles[0]!.trigger("mousedown", { clientX: 0 });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 20 }));
    await nextTick();
    window.dispatchEvent(new MouseEvent("mouseup"));
    await nextTick();
    const saved = wrapper.findAll("button").find((b) => b.text().includes("Save changes"));
    expect(saved!.attributes("disabled")).toBeUndefined();
  });

  it("does not save when there are no pending changes", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    const saveBtn = wrapper.findAll("button").find((b) => b.text().includes("Save changes"));
    expect(saveBtn!.attributes("disabled")).toBeDefined();
  });

  it("drops pending changes once the server reflects them", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    const bar = wrapper.find(".group");
    await bar.trigger("mousedown", { clientX: 0 });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 }));
    await nextTick();
    window.dispatchEvent(new MouseEvent("mouseup"));
    await nextTick();
    let saveBtn = wrapper.findAll("button").find((b) => b.text().includes("Save changes"));
    expect(saveBtn!.attributes("disabled")).toBeUndefined();

    // server pushes the new values → pending entry should clear
    await wrapper.setProps({ moments: [makeMoment({ id: "m1", startSeconds: 20, endSeconds: 50 })] });
    await nextTick();
    saveBtn = wrapper.findAll("button").find((b) => b.text().includes("Save changes"));
    expect(saveBtn!.attributes("disabled")).toBeDefined();
  });

  it("renders a status pill for a processed moment", async () => {
    const wrapper = mountTimeline({
      moments: [
        makeMoment({
          id: "m1",
          startSeconds: 10,
          endSeconds: 40,
          exportStatus: "ready",
          exportVersion: 2,
          exportedVersion: 2,
        }),
      ],
    });
    await nextTick();
    expect(wrapper.text()).toContain("Processed");
  });

  it("renders processing progress in the status pill", async () => {
    const wrapper = mountTimeline({
      moments: [
        makeMoment({
          id: "m1",
          startSeconds: 10,
          endSeconds: 40,
          exportStatus: "processing",
          exportProgress: 60,
        }),
      ],
    });
    await nextTick();
    expect(wrapper.text()).toContain("Processing 60%");
  });

  it("renders a waveform canvas when peaks are supplied", async () => {
    const wrapper = mountTimeline({
      waveformPeaks: [0.1, 0.5, 0.9, 0.3],
      waveformPeaksPerSecond: 50,
    });
    await nextTick();
    expect(wrapper.find("canvas").exists()).toBe(true);
  });

  it("scrubs from the waveform row", async () => {
    const wrapper = mountTimeline({
      waveformPeaks: [0.1, 0.5, 0.9, 0.3],
      waveformPeaksPerSecond: 50,
    });
    await nextTick();
    // sanity: the timeline must have a measurable width for scrubbing to work
    expect(wrapper.find(".timeline-scroll > div").attributes("style")).toContain("width: 1000px");
    await wrapper.find(".waveform-row").trigger("click", { clientX: 100 });
    expect(wrapper.emitted("seek")?.at(-1)).toEqual([10]);
  });

  it("zooms with ctrl+wheel and scrolls with plain wheel", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    const scrollEl = wrapper.find(".timeline-scroll").element as HTMLElement;
    const zoomWheel = new WheelEvent("wheel", { deltaY: -10 });
    Object.defineProperty(zoomWheel, "ctrlKey", { value: true });
    scrollEl.dispatchEvent(zoomWheel);
    await nextTick();
    expect(wrapper.text()).toContain("150%");
    scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: 30 }));
    await nextTick();
    expect(wrapper.exists()).toBe(true);
  });

  it("cleans up listeners on unmount", async () => {
    const wrapper = mountTimeline();
    await nextTick();
    expect(() => wrapper.unmount()).not.toThrow();
    // keydown after unmount should not change zoom on a fresh instance
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z" }));
  });
});
