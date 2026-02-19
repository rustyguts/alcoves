import { mount } from "@vue/test-utils";
import OAuthGoogleButton from "~/components/OAuthGoogleButton.vue";

describe("OAuthGoogleButton", () => {
  it("renders with default props", () => {
    const wrapper = mount(OAuthGoogleButton);
    const link = wrapper.find("a");
    expect(link.attributes("href")).toBe("/api/auth/google");
    expect(link.text()).toContain("Continue with Google");
    expect(link.classes()).toContain("btn-block");
  });

  it("renders with custom href", () => {
    const wrapper = mount(OAuthGoogleButton, {
      props: { href: "/api/auth/google?redirect=/profile" },
    });
    expect(wrapper.find("a").attributes("href")).toBe("/api/auth/google?redirect=/profile");
  });

  it("renders with custom label", () => {
    const wrapper = mount(OAuthGoogleButton, {
      props: { label: "Sign in with Google" },
    });
    expect(wrapper.text()).toContain("Sign in with Google");
  });

  it("does not apply btn-block when block is false", () => {
    const wrapper = mount(OAuthGoogleButton, {
      props: { block: false },
    });
    expect(wrapper.find("a").classes()).not.toContain("btn-block");
  });

  it("renders the Google SVG logo", () => {
    const wrapper = mount(OAuthGoogleButton);
    const svg = wrapper.find("svg");
    expect(svg.exists()).toBe(true);
    const paths = svg.findAll("path");
    expect(paths.length).toBe(4);
  });

  it("has btn class", () => {
    const wrapper = mount(OAuthGoogleButton);
    expect(wrapper.find("a").classes()).toContain("btn");
  });
});
