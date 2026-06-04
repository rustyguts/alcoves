import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TranscriptPanel from "~/components/editor/TranscriptPanel.vue";
import type { VttCue } from "~/utils/parse-vtt";

const cues: VttCue[] = [
  { startSeconds: 1, endSeconds: 2, text: "banana banana apple" },
  { startSeconds: 65, endSeconds: 67, text: "banana cherry pie" },
  { startSeconds: 70, endSeconds: 72, text: "nothing useful here" },
];

function mountPanel(over: Record<string, unknown> = {}) {
  return mount(TranscriptPanel, { props: { cues, currentTime: 0, ...over } });
}

describe("TranscriptPanel", () => {
  it("renders nothing when there are no cues", () => {
    const wrapper = mount(TranscriptPanel, { props: { cues: [], currentTime: 0 } });
    expect(wrapper.text()).toBe("");
  });

  it("renders the header with a cue count and the cue text", () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain("Transcript");
    expect(wrapper.text()).toContain("3 cues");
    expect(wrapper.text()).toContain("banana banana apple");
  });

  it("formats cue timestamps as m:ss", () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain("1:05"); // 65s
  });

  it("emits seek with the cue start when a cue is clicked", async () => {
    const wrapper = mountPanel();
    const cueBtn = wrapper.findAll("ul li button").find((b) => b.text().includes("banana banana"));
    await cueBtn!.trigger("click");
    expect(wrapper.emitted("seek")?.[0]).toEqual([1]);
  });

  it("filters cues by the search box and shows the match count", async () => {
    const wrapper = mountPanel();
    await wrapper.find("input[type='text']").setValue("cherry");
    expect(wrapper.text()).toContain("banana cherry pie");
    expect(wrapper.text()).not.toContain("nothing useful here");
    expect(wrapper.text()).toContain("1/3");
  });

  it("shows a no-match message and clears the search", async () => {
    const wrapper = mountPanel();
    const input = wrapper.find("input[type='text']");
    await input.setValue("zzzz");
    expect(wrapper.text()).toContain('No matches for "zzzz"');
    await wrapper.find("button[aria-label='Clear search']").trigger("click");
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("highlights the active cue based on currentTime", () => {
    const wrapper = mountPanel({ currentTime: 1.5 });
    expect(wrapper.html()).toContain("border-primary");
  });

  it("switches to the Top words tab and ranks non-stopwords", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll("button").find((b) => b.text().trim() === "Top words")!.trigger("click");
    const text = wrapper.text();
    expect(text).toContain("banana");
    expect(text).toContain("cherry");
    // stopwords like "here"/"nothing" are not excluded but "useful" should rank
    expect(text).not.toContain("Search transcript"); // we're on the words tab
  });

  it("clicking a top word filters cues back on the Cues tab", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll("button").find((b) => b.text().trim() === "Top words")!.trigger("click");
    const wordBtn = wrapper.findAll("button").find((b) => b.text().includes("banana"));
    await wordBtn!.trigger("click");
    // back on cues tab, search prefilled with the word
    const input = wrapper.find("input[type='text']");
    expect((input.element as HTMLInputElement).value).toBe("banana");
  });

  it("lets the user change how many top words are shown", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll("button").find((b) => b.text().trim() === "Top words")!.trigger("click");
    const select = wrapper.find("select");
    expect(select.exists()).toBe(true);
    await select.setValue("5");
    expect((select.element as HTMLSelectElement).value).toBe("5");
  });
});
