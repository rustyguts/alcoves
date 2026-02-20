import { mount } from "@vue/test-utils";
import EmojiPicker from "~/components/EmojiPicker.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

describe("EmojiPicker", () => {
  it("displays the selected emoji", () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: "\u{1F680}" },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("\u{1F680}");
  });

  it("shows icon placeholder when no emoji selected", () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    expect(wrapper.findComponent(stubs.AppIcon).exists()).toBe(true);
  });

  it("opens picker on button click", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    expect(wrapper.find(".absolute").exists()).toBe(false);
    await wrapper.find("button").trigger("click");
    expect(wrapper.find(".absolute").exists()).toBe(true);
  });

  it("closes picker on second button click", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.find(".absolute").exists()).toBe(true);
    await wrapper.find("button").trigger("click");
    expect(wrapper.find(".absolute").exists()).toBe(false);
  });

  it("emits update:modelValue when an emoji is clicked", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");

    // Find an emoji button in the grid
    const emojiButtons = wrapper.findAll(".grid button");
    expect(emojiButtons.length).toBeGreaterThan(0);
    await emojiButtons[0]!.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(typeof wrapper.emitted("update:modelValue")![0]![0]).toBe("string");
  });

  it("closes picker after selecting an emoji", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");

    const emojiButtons = wrapper.findAll(".grid button");
    await emojiButtons[0]!.trigger("click");

    expect(wrapper.find(".absolute").exists()).toBe(false);
  });

  it("shows Remove button when an emoji is selected", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: "\u{1F60A}" },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");

    const removeBtn = wrapper.findAll("button").find((b) => b.text().includes("Remove"));
    expect(removeBtn).toBeDefined();
  });

  it("does not show Remove button when no emoji is selected", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");

    const removeBtn = wrapper.findAll("button").find((b) => b.text().includes("Remove"));
    expect(removeBtn).toBeUndefined();
  });

  it("emits null when Remove is clicked", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: "\u{1F60A}" },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");

    const removeBtn = wrapper.findAll("button").find((b) => b.text().includes("Remove"));
    await removeBtn?.trigger("click");

    expect(wrapper.emitted("update:modelValue")![0]![0]).toBeNull();
  });

  it("renders category labels", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");

    expect(wrapper.text()).toContain("Smileys");
    expect(wrapper.text()).toContain("Nature");
    expect(wrapper.text()).toContain("Animals");
    expect(wrapper.text()).toContain("Food");
    expect(wrapper.text()).toContain("Objects");
    expect(wrapper.text()).toContain("Travel");
  });

  it("highlights the currently selected emoji", async () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: "\u{1F60A}" },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");

    const highlighted = wrapper
      .findAll(".grid button")
      .find((b) => b.classes().includes("bg-primary/20"));
    expect(highlighted).toBeDefined();
    expect(highlighted?.text()).toContain("\u{1F60A}");
  });

  it("has the toggle button with title attribute", () => {
    const wrapper = mount(EmojiPicker, {
      props: { modelValue: null },
      global: { stubs },
    });
    expect(wrapper.find("button").attributes("title")).toBe("Choose emoji icon");
  });
});
