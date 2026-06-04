import { mount } from "@vue/test-utils";
import LibraryHeader from "~/components/LibraryHeader.vue";

// The breadcrumb is exercised in its own spec; here we stub it so we can test
// LibraryHeader's composition (emoji prefix + breadcrumb + slots) in isolation.
const stubs = {
  LibraryBreadcrumb: {
    name: "LibraryBreadcrumb",
    template: '<nav class="lib-breadcrumb-stub">{{ libraryName }}</nav>',
    props: ["libraryId", "libraryName"],
  },
};

describe("LibraryHeader", () => {
  it("renders the library name via the breadcrumb", () => {
    const wrapper = mount(LibraryHeader, {
      props: { libraryId: "lib-1", name: "My Library" },
      global: { stubs },
    });
    expect(wrapper.find(".lib-breadcrumb-stub").text()).toBe("My Library");
  });

  it("passes libraryId and name through to the breadcrumb", () => {
    const wrapper = mount(LibraryHeader, {
      props: { libraryId: "lib-9", name: "Photos" },
      global: { stubs },
    });
    const breadcrumb = wrapper.findComponent({ name: "LibraryBreadcrumb" });
    expect(breadcrumb.props("libraryId")).toBe("lib-9");
    expect(breadcrumb.props("libraryName")).toBe("Photos");
  });

  it("renders the emoji as a display-only prefix when present", () => {
    const wrapper = mount(LibraryHeader, {
      props: { libraryId: "lib-1", name: "Lib", emoji: "\u{1F680}" },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("\u{1F680}");
  });

  it("does not render an emoji when absent", () => {
    const wrapper = mount(LibraryHeader, {
      props: { libraryId: "lib-1", name: "Lib" },
      global: { stubs },
    });
    expect(wrapper.text()).not.toContain("\u{1F680}");
  });

  it("is not editable: no rename input or heading affordance", () => {
    const wrapper = mount(LibraryHeader, {
      props: { libraryId: "lib-1", name: "Lib" },
      global: { stubs },
    });
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find("h1").exists()).toBe(false);
  });

  it("renders the default slot (tabs)", () => {
    const wrapper = mount(LibraryHeader, {
      props: { libraryId: "lib-1", name: "Lib" },
      global: { stubs },
      slots: { default: "<div>TABS</div>" },
    });
    expect(wrapper.text()).toContain("TABS");
  });

  it("renders the actions slot", () => {
    const wrapper = mount(LibraryHeader, {
      props: { libraryId: "lib-1", name: "Lib" },
      global: { stubs },
      slots: { actions: "<button>Action</button>" },
    });
    expect(wrapper.text()).toContain("Action");
  });
});
