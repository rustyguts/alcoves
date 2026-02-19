import { mount } from "@vue/test-utils";
import ConfirmModal from "~/components/ConfirmModal.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  AppModal: {
    template: '<div class="app-modal"><slot /></div>',
    props: ["open"],
  },
};

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
      global: { stubs },
    });
  }

  it("renders title and message", () => {
    const wrapper = mountComponent();
    expect(wrapper.find("h3").text()).toBe("Confirm Delete");
    expect(wrapper.text()).toContain("Are you sure you want to delete this?");
  });

  it("renders confirm button with custom label", () => {
    const wrapper = mountComponent({ confirmLabel: "Remove" });
    const buttons = wrapper.findAll("button");
    const confirmBtn = buttons.find((b) => b.text().includes("Remove"));
    expect(confirmBtn).toBeDefined();
  });

  it("renders cancel button", () => {
    const wrapper = mountComponent();
    const cancelBtn = wrapper.findAll("button").find((b) => b.text().includes("Cancel"));
    expect(cancelBtn).toBeDefined();
  });

  it("emits confirm when confirm button is clicked", async () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll("button");
    const confirmBtn = buttons.find((b) => b.text().includes("Delete"));
    await confirmBtn?.trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("emits update:open with false when cancel is clicked", async () => {
    const wrapper = mountComponent();
    const cancelBtn = wrapper.findAll("button").find((b) => b.text().includes("Cancel"));
    await cancelBtn?.trigger("click");
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("applies custom confirmClass", () => {
    const wrapper = mountComponent({ confirmClass: "btn-error" });
    const buttons = wrapper.findAll("button");
    const confirmBtn = buttons.find((b) => b.text().includes("Delete"));
    expect(confirmBtn?.classes()).toContain("btn-error");
  });

  it("disables buttons when pending is true", () => {
    const wrapper = mountComponent({ pending: true });
    const buttons = wrapper.findAll("button");
    for (const btn of buttons) {
      expect(btn.attributes("disabled")).toBeDefined();
    }
  });

  it("shows loading spinner when pending", () => {
    const wrapper = mountComponent({ pending: true });
    expect(wrapper.find(".loading").exists()).toBe(true);
  });

  it("shows icon when not pending", () => {
    const wrapper = mountComponent({ pending: false });
    expect(wrapper.find(".loading").exists()).toBe(false);
  });
});
