import { mount } from "@vue/test-utils";
import UserAvatar from "~/components/UserAvatar.vue";

describe("UserAvatar", () => {
  it("renders initial letter when no avatar URL", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "John Doe" },
    });
    expect(wrapper.text()).toContain("J");
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("renders image when avatarUrl is provided", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "John Doe", avatarUrl: "/images/john.jpg" },
    });
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("/images/john.jpg");
    expect(img.attributes("alt")).toBe("John Doe");
  });

  it("uppercases the first character of displayName", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "alice" },
    });
    expect(wrapper.text()).toContain("A");
  });

  it("uses U as fallback for empty display name", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "" },
    });
    expect(wrapper.text()).toContain("U");
  });

  it("trims whitespace before extracting initial", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "  Bob" },
    });
    expect(wrapper.text()).toContain("B");
  });

  it("applies default size classes", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Test" },
    });
    const innerDiv = wrapper.find(".w-8");
    expect(innerDiv.exists()).toBe(true);
  });

  it("applies custom size class", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Test", sizeClass: "w-12" },
    });
    expect(wrapper.find(".w-12").exists()).toBe(true);
  });

  it("applies custom bg class for initial fallback", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Test", bgClass: "bg-primary text-primary-content" },
    });
    expect(wrapper.find(".bg-primary").exists()).toBe(true);
  });

  it("applies tooltip when tooltip prop is true", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Jane", tooltip: true },
    });
    const outer = wrapper.find(".avatar");
    expect(outer.classes()).toContain("tooltip");
    expect(outer.attributes("data-tip")).toBe("Jane");
  });

  it("does not apply tooltip by default", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Jane" },
    });
    const outer = wrapper.find(".avatar");
    expect(outer.classes()).not.toContain("tooltip");
    expect(outer.attributes("data-tip")).toBeUndefined();
  });

  it("applies custom tooltip position", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Jane", tooltip: true, tooltipPosition: "bottom" },
    });
    const outer = wrapper.find(".avatar");
    expect(outer.classes()).toContain("tooltip-bottom");
  });

  it("applies custom rounded class", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Test", roundedClass: "rounded-lg" },
    });
    expect(wrapper.find(".rounded-lg").exists()).toBe(true);
  });

  it("renders initial fallback when avatarUrl is null", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Test User", avatarUrl: null },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("T");
  });
});
