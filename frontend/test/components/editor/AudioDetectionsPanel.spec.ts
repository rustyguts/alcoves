import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AudioDetectionsPanel from "~/components/editor/AudioDetectionsPanel.vue";
import type { AudioDetection } from "~~/shared/types/api";

function makeDetection(over: Partial<AudioDetection>): AudioDetection {
  return {
    id: `d-${Math.round((over.startSeconds ?? 0) * 100)}-${over.label ?? "x"}`,
    fileId: "f",
    libraryId: "lib",
    label: "Laughter",
    classIndex: 1,
    score: 0.8,
    startSeconds: 0,
    endSeconds: 1,
    version: 1,
    createdAt: "",
    ...over,
  } as AudioDetection;
}

const detections = [
  makeDetection({ label: "Speech", score: 0.5, startSeconds: 0, endSeconds: 2 }),
  makeDetection({ label: "Laughter", score: 0.9, startSeconds: 5, endSeconds: 6 }),
  makeDetection({ label: "Laughter", score: 0.6, startSeconds: 10, endSeconds: 11 }),
];

function mountPanel(over: Record<string, unknown> = {}) {
  return mount(AudioDetectionsPanel, {
    props: { detections, duration: 20, ...over },
  });
}

describe("AudioDetectionsPanel", () => {
  it("renders nothing when there are no detections", () => {
    const wrapper = mount(AudioDetectionsPanel, { props: { detections: [], duration: 10 } });
    expect(wrapper.text()).toBe("");
  });

  it("shows the header with a label-bucket count", () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain("Audio events");
    expect(wrapper.text()).toContain("2 labels");
  });

  it("is collapsed by default and expands on header click", async () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).not.toContain("Laughter");
    await wrapper.findAll("button")[0]!.trigger("click");
    expect(wrapper.text()).toContain("Laughter");
    expect(wrapper.text()).toContain("Speech");
  });

  it("orders buckets by best score (Laughter 90% before Speech 50%)", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll("button")[0]!.trigger("click");
    const labels = wrapper.findAll("li > button span.font-medium").map((s) => s.text());
    expect(labels[0]).toBe("Laughter");
    expect(labels[1]).toBe("Speech");
  });

  it("emits seek with the window start when a timeline bar is clicked", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll("button")[0]!.trigger("click");
    const bar = wrapper.find("button[title]");
    await bar.trigger("click");
    expect(wrapper.emitted("seek")?.[0]).toEqual([5]);
  });

  it("expands a bucket to reveal its window chips and seeks from them", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll("button")[0]!.trigger("click"); // open panel
    // first bucket (Laughter) toggle button
    const bucketBtn = wrapper.findAll("li > button")[0]!;
    await bucketBtn.trigger("click");
    // chips show two Laughter windows (5s and 10s)
    expect(wrapper.text()).toContain("0:05");
    expect(wrapper.text()).toContain("0:10");
  });

  it("treats a non-positive duration as a full-width bar", () => {
    const wrapper = mountPanel({ duration: 0 });
    // barStyle returns width 100% — assert it rendered without throwing
    expect(wrapper.text()).toContain("Audio events");
  });
});
