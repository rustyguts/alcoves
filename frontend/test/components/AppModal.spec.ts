import { mount } from "@vue/test-utils";
import AppModal from "~/components/AppModal.vue";

describe("AppModal", () => {
  it("renders slot content when open", () => {
    const wrapper = mount(AppModal, {
      props: { open: true },
      slots: { default: "<p>Modal content</p>" },
    });
    expect(wrapper.text()).toContain("Modal content");
  });

  it("does not render when closed", () => {
    const wrapper = mount(AppModal, {
      props: { open: false },
      slots: { default: "<p>Modal content</p>" },
    });
    expect(wrapper.text()).not.toContain("Modal content");
  });
});
