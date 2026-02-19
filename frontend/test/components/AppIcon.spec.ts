import { mount } from "@vue/test-utils";
import AppIcon from "~/components/AppIcon.vue";

vi.mock("@iconify/vue", () => ({
  Icon: {
    name: "Icon",
    props: ["icon"],
    template: '<i :data-icon="icon" />',
  },
}));

describe("AppIcon", () => {
  it("converts i-lucide-xxx format to lucide:xxx", () => {
    const wrapper = mount(AppIcon, { props: { name: "i-lucide-chevron-left" } });
    expect(wrapper.find("i").attributes("data-icon")).toBe("lucide:chevron-left");
  });

  it("converts i-lucide single-word icon names", () => {
    const wrapper = mount(AppIcon, { props: { name: "i-lucide-menu" } });
    expect(wrapper.find("i").attributes("data-icon")).toBe("lucide:menu");
  });

  it("converts other icon collections", () => {
    const wrapper = mount(AppIcon, { props: { name: "i-mdi-home" } });
    expect(wrapper.find("i").attributes("data-icon")).toBe("mdi:home");
  });

  it("passes through names that do not start with i-", () => {
    const wrapper = mount(AppIcon, { props: { name: "lucide:check" } });
    expect(wrapper.find("i").attributes("data-icon")).toBe("lucide:check");
  });

  it("passes through names with no dash after collection", () => {
    const wrapper = mount(AppIcon, { props: { name: "i-nodash" } });
    // "nodash" has no dash, so dashIdx is -1 and it returns the raw string
    expect(wrapper.find("i").attributes("data-icon")).toBe("i-nodash");
  });

  it("handles multi-dash icon names correctly", () => {
    const wrapper = mount(AppIcon, { props: { name: "i-lucide-arrow-up-right" } });
    expect(wrapper.find("i").attributes("data-icon")).toBe("lucide:arrow-up-right");
  });
});
