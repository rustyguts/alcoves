import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EditorKeyboardHelpModal from "~/components/editor/EditorKeyboardHelpModal.vue";

describe("EditorKeyboardHelpModal", () => {
  it("renders the shortcut sections when open", () => {
    const wrapper = mount(EditorKeyboardHelpModal, { props: { open: true } });
    const text = wrapper.text();
    expect(text).toContain("Timeline");
    expect(text).toContain("Moments");
    expect(text).toContain("Playback");
    expect(text).toContain("Zoom in");
    expect(text).toContain("New moment at playhead");
    expect(text).toContain("Play / pause");
  });

  it("renders nothing visible when closed", () => {
    const wrapper = mount(EditorKeyboardHelpModal, { props: { open: false } });
    expect(wrapper.text()).not.toContain("Zoom in");
  });

  it("renders the key caps for a shortcut", () => {
    const wrapper = mount(EditorKeyboardHelpModal, { props: { open: true } });
    const kbds = wrapper.findAll("kbd").map((k) => k.text());
    expect(kbds).toContain("Z");
    expect(kbds).toContain("Space");
  });
});
