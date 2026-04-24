import { mount } from "@vue/test-utils";
import ConfirmModal from "~/components/ConfirmModal.vue";

describe("ConfirmModal", () => {
  function mountComponent(props: Record<string, unknown> = {}) {
    return mount(ConfirmModal, {
      props: {
        open: true,
        title: "Confirm Delete",
        message: "Are you sure you want to delete this?",
        confirmLabel: "Delete",
        ...props,
      },
    });
  }

  it("renders title and message", () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("Confirm Delete");
    expect(wrapper.text()).toContain("Are you sure you want to delete this?");
  });

  it("renders confirm button with custom label", () => {
    const wrapper = mountComponent({ confirmLabel: "Remove" });
    expect(wrapper.text()).toContain("Remove");
  });

  it("renders cancel button", () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain("Cancel");
  });

  it("emits confirm when confirm button is clicked", async () => {
    const wrapper = mountComponent();
    const confirmBtn = wrapper.findAll("button").find((b) => b.text().includes("Delete"));
    await confirmBtn?.trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("emits update:open with false when cancel is clicked", async () => {
    const wrapper = mountComponent();
    const cancelBtn = wrapper.findAll("button").find((b) => b.text().includes("Cancel"));
    await cancelBtn?.trigger("click");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("disables buttons when pending is true", () => {
    const wrapper = mountComponent({ pending: true });
    const buttons = wrapper.findAll("button");
    for (const btn of buttons) {
      expect(btn.attributes("disabled")).toBeDefined();
    }
  });
});
