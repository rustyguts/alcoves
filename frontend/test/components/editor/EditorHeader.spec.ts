import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EditorHeader from "~/components/editor/EditorHeader.vue";
import type { LibraryFile } from "~~/shared/types/api";
import type { JobStatusButton } from "~/utils/job-status-button";

const btn = (label: string): JobStatusButton => ({
  label,
  color: "primary",
  loading: false,
  disabled: false,
});

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
  return { id: "f1", name: "clip.mp4", mimeType: "video/mp4", tags: [], ...over } as LibraryFile;
}

function mountHeader(over: Record<string, unknown> = {}) {
  return mount(EditorHeader, {
    props: {
      file: makeFile(),
      transcribing: false,
      transcribeButton: btn("Transcribe"),
      audioDetecting: false,
      audioDetectButton: btn("Detect sounds"),
      canDetectAudio: true,
      waveformGenerating: false,
      waveformButton: btn("Generate waveform"),
      ...over,
    },
  });
}

describe("EditorHeader", () => {
  it("renders the file name", () => {
    expect(mountHeader().text()).toContain("clip.mp4");
  });

  it("shows a loading placeholder when no file", () => {
    expect(mountHeader({ file: null }).text()).toContain("Loading…");
  });

  it("emits back when the Back button is clicked", async () => {
    const wrapper = mountHeader();
    const back = wrapper.findAll("button").find((b) => b.text().includes("Back"));
    await back!.trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
  });

  it("shows transcribe/audio-detect/waveform actions for a playable file and emits them", async () => {
    const wrapper = mountHeader();
    const find = (label: string) =>
      wrapper.findAll("button").find((b) => b.text().includes(label));

    await find("Transcribe")!.trigger("click");
    await find("Detect sounds")!.trigger("click");
    await find("Generate waveform")!.trigger("click");

    expect(wrapper.emitted("transcribe")).toHaveLength(1);
    expect(wrapper.emitted("audio-detect")).toHaveLength(1);
    expect(wrapper.emitted("waveform")).toHaveLength(1);
  });

  it("hides playback actions for a non-playable file", () => {
    const wrapper = mountHeader({ file: makeFile({ mimeType: "image/png" }), canDetectAudio: false });
    expect(wrapper.text()).not.toContain("Transcribe");
    expect(wrapper.text()).not.toContain("Generate waveform");
  });

  it("hides the audio-detect action when canDetectAudio is false", () => {
    const wrapper = mountHeader({ canDetectAudio: false });
    expect(wrapper.text()).not.toContain("Detect sounds");
  });
});
