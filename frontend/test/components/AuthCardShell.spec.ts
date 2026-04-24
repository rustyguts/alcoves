import { mount } from "@vue/test-utils";
import AuthCardShell from "~/components/AuthCardShell.vue";

describe("AuthCardShell", () => {
  it("renders title and subtitle", () => {
    const wrapper = mount(AuthCardShell, {
      props: { title: "Sign In", subtitle: "Welcome back" },
    });
    expect(wrapper.find("h2").text()).toBe("Sign In");
    expect(wrapper.text()).toContain("Welcome back");
  });

  it("renders the logo image", () => {
    const wrapper = mount(AuthCardShell, {
      props: { title: "Login", subtitle: "Enter your credentials" },
    });
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("alt")).toBe("Alcoves");
    expect(img.attributes("src")).toBe("/logo.webp");
  });

  it("shows error message when error prop is provided", () => {
    const wrapper = mount(AuthCardShell, {
      props: { title: "Login", subtitle: "Enter credentials", error: "Invalid password" },
    });
    const alert = wrapper.find(".u-alert");
    expect(alert.exists()).toBe(true);
    expect(wrapper.text()).toContain("Invalid password");
  });

  it("hides error message when error prop is empty", () => {
    const wrapper = mount(AuthCardShell, {
      props: { title: "Login", subtitle: "Enter credentials", error: "" },
    });
    expect(wrapper.find(".u-alert").exists()).toBe(false);
  });

  it("hides error message when error prop is not provided", () => {
    const wrapper = mount(AuthCardShell, {
      props: { title: "Login", subtitle: "Sub" },
    });
    expect(wrapper.find(".u-alert").exists()).toBe(false);
  });

  it("renders default slot content", () => {
    const wrapper = mount(AuthCardShell, {
      props: { title: "T", subtitle: "S" },
      slots: { default: "<form>My Form</form>" },
    });
    expect(wrapper.text()).toContain("My Form");
  });

  it("renders footer slot content", () => {
    const wrapper = mount(AuthCardShell, {
      props: { title: "T", subtitle: "S" },
      slots: { footer: "<p>Footer text</p>" },
    });
    expect(wrapper.text()).toContain("Footer text");
  });
});
