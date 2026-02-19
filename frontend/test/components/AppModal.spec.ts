import { mount } from "@vue/test-utils";
import AppModal from "~/components/AppModal.vue";

describe("AppModal", () => {
  it("renders with modal-open class when open is true", () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: "<p>Modal content</p>" },
    });
    expect(wrapper.find("dialog").classes()).toContain("modal-open");
  });

  it("does not have modal-open class when open is false", () => {
    const wrapper = mount(AppModal, {
      props: { open: false },
      slots: { default: "<p>Modal content</p>" },
    });
    expect(wrapper.find("dialog").classes()).not.toContain("modal-open");
  });

  it("renders slot content inside modal-box", () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: "<p>Hello World</p>" },
    });
    expect(wrapper.find(".modal-box").text()).toContain("Hello World");
  });

  it("applies custom boxClass to modal-box", () => {
    const wrapper = mount(AppModal, {
      props: { open: true, boxClass: "max-w-3xl" },
      slots: { default: "<p>Content</p>" },
    });
    expect(wrapper.find(".modal-box").classes()).toContain("max-w-3xl");
  });

  it("emits update:open with false when backdrop is clicked", async () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: "<p>Content</p>" },
    });
    await wrapper.find(".modal-backdrop").trigger("click");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("uses empty string as default boxClass", () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: "<p>Content</p>" },
    });
    const box = wrapper.find(".modal-box");
    expect(box.exists()).toBe(true);
  });

  it("contains a close button inside the backdrop form", () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: "<p>Content</p>" },
    });
    const form = wrapper.find("form.modal-backdrop");
    expect(form.exists()).toBe(true);
    expect(form.find("button").text()).toBe("close");
  });
});
