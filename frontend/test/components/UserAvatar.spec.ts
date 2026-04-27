import { mount } from "@vue/test-utils";
import UserAvatar from "~/components/UserAvatar.vue";

describe("UserAvatar", () => {
  it("renders initial letter when no avatar URL", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "John Doe" },
    });
    // Component renders the upper-cased first letter, not the full name.
    expect(wrapper.text()).toBe("J");
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

  it("passes alt equal to displayName", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Alice", avatarUrl: "/a.jpg" },
    });
    expect(wrapper.find("img").attributes("alt")).toBe("Alice");
  });

  it("wraps with tooltip when tooltip prop is true", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Jane", tooltip: true },
    });
    expect(wrapper.find(".u-tooltip").exists()).toBe(true);
  });

  it("does not wrap with tooltip by default", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Jane" },
    });
    expect(wrapper.find(".u-tooltip").exists()).toBe(false);
  });

  it("renders avatar text fallback", () => {
    const wrapper = mount(UserAvatar, {
      props: { displayName: "Test User", avatarUrl: null },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toBe("T");
  });
});
