import { mount } from "@vue/test-utils";
import OAuthGoogleButton from "~/components/OAuthGoogleButton.vue";

describe("OAuthGoogleButton", () => {
  it("renders with default props", () => {
    const wrapper = mount(OAuthGoogleButton);
    expect(wrapper.text()).toContain("Continue with Google");
  });

  it("renders with custom href", () => {
    const wrapper = mount(OAuthGoogleButton, {
      props: { href: "/api/auth/google?redirect=/profile" },
    });
    // The stub UButton accepts a `to` prop
    expect(wrapper.html()).toBeTruthy();
  });

  it("renders with custom label", () => {
    const wrapper = mount(OAuthGoogleButton, {
      props: { label: "Sign in with Google" },
    });
    expect(wrapper.text()).toContain("Sign in with Google");
  });

  it("renders the Google SVG logo", () => {
    const wrapper = mount(OAuthGoogleButton);
    const svg = wrapper.find("svg");
    expect(svg.exists()).toBe(true);
    const paths = svg.findAll("path");
    expect(paths.length).toBe(4);
  });
});
