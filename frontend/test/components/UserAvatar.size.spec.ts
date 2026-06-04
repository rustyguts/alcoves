import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import UserAvatar from "~/components/UserAvatar.vue";

function avatarProps(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent({ name: "UAvatar" }).props();
}

describe("UserAvatar size mapping", () => {
  it.each([
    ["w-4", "3xs"],
    ["w-5", "2xs"],
    ["w-6", "xs"],
    ["w-8", "sm"],
    ["w-10", "md"],
    ["w-12", "lg"],
    ["w-14", "xl"],
    ["w-16", "2xl"],
    ["w-20", "3xl"],
    ["w-99", "sm"], // unknown → default sm
  ])("maps sizeClass %s to avatar size %s", (sizeClass, expected) => {
    const wrapper = mount(UserAvatar, { props: { displayName: "X", sizeClass } });
    expect(avatarProps(wrapper).size).toBe(expected);
  });

  it("supports the size-N class form", () => {
    const wrapper = mount(UserAvatar, { props: { displayName: "X", sizeClass: "size-16" } });
    expect(avatarProps(wrapper).size).toBe("2xl");
  });

  it("wraps the avatar in a tooltip when enabled", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Carol", tooltip: true, tooltipPosition: "bottom" },
    });
    expect(wrapper.findComponent({ name: "UTooltip" }).exists()).toBe(true);
  });
});
