import { mount } from "@vue/test-utils";
import TagColorPickerDropdown from "~/components/library/TagColorPickerDropdown.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

const palette = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"] as const;

describe("TagColorPickerDropdown", () => {
  function mountPicker(props: Record<string, unknown> = {}) {
    return mount(TagColorPickerDropdown, {
      props: {
        open: false,
        color: "#FF0000",
        draft: "#FF0000",
        palette,
        keyId: "tag-1",
        ...props,
      },
      global: { stubs },
    });
  }

  it("renders a color swatch button", () => {
    const wrapper = mountPicker();
    const swatch = wrapper.find("summary span");
    expect(swatch.exists()).toBe(true);
    expect(swatch.attributes("style")).toContain("background-color: rgb(255, 0, 0)");
  });

  it("emits toggle on summary click", async () => {
    const wrapper = mountPicker();
    await wrapper.find("summary").trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("renders palette buttons when open", () => {
    const wrapper = mountPicker({ open: true });
    const paletteButtons = wrapper.findAll(".grid button");
    expect(paletteButtons).toHaveLength(4);
  });

  it("emits pick when a palette color is clicked", async () => {
    const wrapper = mountPicker({ open: true });
    const buttons = wrapper.findAll(".grid button");
    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("pick")![0]).toEqual(["#00FF00"]);
  });

  it("highlights the selected color in the palette", () => {
    const wrapper = mountPicker({ open: true });
    const highlighted = wrapper.findAll(".grid button").find((b) => b.classes().includes("ring-2"));
    expect(highlighted).toBeDefined();
  });

  it("renders hex input field", () => {
    const wrapper = mountPicker({ open: true });
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("#FF0000");
  });

  it("emits updateDraft on input", async () => {
    const wrapper = mountPicker({ open: true });
    const input = wrapper.find("input");
    await input.trigger("input");
    expect(wrapper.emitted("updateDraft")).toBeDefined();
  });

  it("emits commitDraft on blur", async () => {
    const wrapper = mountPicker({ open: true });
    const input = wrapper.find("input");
    await input.trigger("blur");
    expect(wrapper.emitted("commitDraft")).toHaveLength(1);
  });

  it("emits commitDraft on Enter key", async () => {
    const wrapper = mountPicker({ open: true });
    const input = wrapper.find("input");
    await input.trigger("keydown.enter");
    expect(wrapper.emitted("commitDraft")).toHaveLength(1);
  });

  it("uses custom title prop", () => {
    const wrapper = mountPicker({ title: "Pick color" });
    expect(wrapper.find("summary").attributes("title")).toBe("Pick color");
  });

  it("uses default title", () => {
    const wrapper = mountPicker();
    expect(wrapper.find("summary").attributes("title")).toBe("Select tag color");
  });
});
