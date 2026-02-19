import { mount } from "@vue/test-utils";
import LibraryHeader from "~/components/LibraryHeader.vue";

const stubs = {
  EmojiPicker: {
    template: '<div class="emoji-picker-stub" />',
    props: ["modelValue"],
  },
};

describe("LibraryHeader", () => {
  it("renders library name", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "My Library" },
      global: { stubs },
    });
    expect(wrapper.find("h1").text()).toBe("My Library");
  });

  it("renders emoji when canEdit is false", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Lib", emoji: "\u{1F680}", canEdit: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("\u{1F680}");
    expect(wrapper.find(".emoji-picker-stub").exists()).toBe(false);
  });

  it("renders EmojiPicker when canEdit is true", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Lib", emoji: "\u{1F680}", canEdit: true },
      global: { stubs },
    });
    expect(wrapper.find(".emoji-picker-stub").exists()).toBe(true);
  });

  it("does not show emoji picker or emoji when both are absent", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Lib", canEdit: false },
      global: { stubs },
    });
    expect(wrapper.find(".emoji-picker-stub").exists()).toBe(false);
  });

  it("makes name clickable when canEdit is true", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Editable", canEdit: true },
      global: { stubs },
    });
    expect(wrapper.find("h1").classes()).toContain("cursor-pointer");
  });

  it("does not make name clickable when canEdit is false", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Readonly", canEdit: false },
      global: { stubs },
    });
    expect(wrapper.find("h1").classes()).not.toContain("cursor-pointer");
  });

  it("switches to edit mode on name click when canEdit", async () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Original", canEdit: true },
      global: { stubs },
    });
    await wrapper.find("h1").trigger("click");
    expect(wrapper.find("input").exists()).toBe(true);
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Original");
  });

  it("does not switch to edit mode on name click when canEdit is false", async () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Original", canEdit: false },
      global: { stubs },
    });
    await wrapper.find("h1").trigger("click");
    expect(wrapper.find("input").exists()).toBe(false);
  });

  it("emits update:name on blur with changed value", async () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Original", canEdit: true },
      global: { stubs },
    });
    await wrapper.find("h1").trigger("click");
    const input = wrapper.find("input");
    await input.setValue("New Name");
    await input.trigger("blur");
    expect(wrapper.emitted("update:name")?.[0]).toEqual(["New Name"]);
  });

  it("does not emit update:name if value is unchanged", async () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Same", canEdit: true },
      global: { stubs },
    });
    await wrapper.find("h1").trigger("click");
    await wrapper.find("input").trigger("blur");
    expect(wrapper.emitted("update:name")).toBeUndefined();
  });

  it("does not emit update:name if value is empty after trim", async () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Original", canEdit: true },
      global: { stubs },
    });
    await wrapper.find("h1").trigger("click");
    await wrapper.find("input").setValue("   ");
    await wrapper.find("input").trigger("blur");
    expect(wrapper.emitted("update:name")).toBeUndefined();
  });

  it("saves name on Enter key", async () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Original", canEdit: true },
      global: { stubs },
    });
    await wrapper.find("h1").trigger("click");
    await wrapper.find("input").setValue("Enter Name");
    await wrapper.find("input").trigger("keydown.enter");
    expect(wrapper.emitted("update:name")?.[0]).toEqual(["Enter Name"]);
  });

  it("cancels editing on Escape key", async () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Original", canEdit: true },
      global: { stubs },
    });
    await wrapper.find("h1").trigger("click");
    expect(wrapper.find("input").exists()).toBe(true);
    await wrapper.find("input").trigger("keydown.escape");
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find("h1").exists()).toBe(true);
  });

  it("renders actions slot", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Lib" },
      global: { stubs },
      slots: { actions: "<button>Action</button>" },
    });
    expect(wrapper.text()).toContain("Action");
  });

  it("renders subtitle slot", () => {
    const wrapper = mount(LibraryHeader, {
      props: { name: "Lib" },
      global: { stubs },
      slots: { subtitle: "<span>3 files</span>" },
    });
    expect(wrapper.text()).toContain("3 files");
  });
});
