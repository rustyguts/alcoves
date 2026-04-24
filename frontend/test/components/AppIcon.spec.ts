import { mount } from "@vue/test-utils";
import AppIcon from "~/components/AppIcon.vue";

describe("AppIcon", () => {
  it("forwards the name prop to UIcon", () => {
    const wrapper = mount(AppIcon, { props: { name: "i-lucide-chevron-left" } });
    const icon = wrapper.find("[data-icon='i-lucide-chevron-left']");
    expect(icon.exists()).toBe(true);
  });

  it("accepts collection:name format", () => {
    const wrapper = mount(AppIcon, { props: { name: "lucide:check" } });
    const icon = wrapper.find("[data-icon='lucide:check']");
    expect(icon.exists()).toBe(true);
  });

  it("renders for any collection", () => {
    const wrapper = mount(AppIcon, { props: { name: "i-mdi-home" } });
    const icon = wrapper.find("[data-icon='i-mdi-home']");
    expect(icon.exists()).toBe(true);
  });
});
