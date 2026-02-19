import { mount } from "@vue/test-utils";
import ContextMenuItemsRenderer from "~/components/ContextMenuItemsRenderer.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

describe("ContextMenuItemsRenderer", () => {
  it("renders flat menu items", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: {
        groups: [[{ label: "Open" }, { label: "Delete" }]],
      },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Open");
    expect(wrapper.text()).toContain("Delete");
  });

  it("emits select when clicking a flat item", async () => {
    const item = { label: "Rename", icon: "i-lucide-pencil" };
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: { groups: [[item]] },
      global: { stubs },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);
    expect(wrapper.emitted("select")![0]![0]).toEqual(item);
  });

  it("renders icons when provided", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: {
        groups: [[{ label: "Edit", icon: "i-lucide-edit" }]],
      },
      global: { stubs },
    });
    expect(wrapper.findComponent(stubs.AppIcon).exists()).toBe(true);
  });

  it("renders items with error color", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: {
        groups: [[{ label: "Delete", color: "error" as const }]],
      },
      global: { stubs },
    });
    const btn = wrapper.find("button");
    expect(btn.classes()).toContain("text-error");
  });

  it("renders disabled items", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: {
        groups: [[{ label: "Locked", disabled: true }]],
      },
      global: { stubs },
    });
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
  });

  it("renders dividers between groups", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: {
        groups: [[{ label: "Group1" }], [{ label: "Group2" }]],
      },
      global: { stubs },
    });
    const dividers = wrapper.findAll(".menu-title");
    expect(dividers).toHaveLength(1);
  });

  it("renders nested children as details/summary", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: {
        groups: [
          [
            {
              label: "Move to",
              children: [{ label: "Folder A" }, { label: "Folder B" }],
            },
          ],
        ],
      },
      global: { stubs },
    });
    expect(wrapper.find("details").exists()).toBe(true);
    expect(wrapper.find("summary").text()).toContain("Move to");
    expect(wrapper.text()).toContain("Folder A");
    expect(wrapper.text()).toContain("Folder B");
  });

  it("emits select for nested child clicks", async () => {
    const child = { label: "Subfolder" };
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: {
        groups: [[{ label: "Move to", children: [child] }]],
      },
      global: { stubs },
    });
    const childBtn = wrapper.findAll("button").find((b) => b.text().includes("Subfolder"));
    await childBtn?.trigger("click");
    expect(wrapper.emitted("select")?.[0]?.[0]).toEqual(child);
  });

  it("handles empty groups array", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: { groups: [] },
      global: { stubs },
    });
    expect(wrapper.text()).toBe("");
  });

  it("does not render divider before first group", () => {
    const wrapper = mount(ContextMenuItemsRenderer, {
      props: { groups: [[{ label: "Only group" }]] },
      global: { stubs },
    });
    expect(wrapper.findAll(".menu-title")).toHaveLength(0);
  });
});
