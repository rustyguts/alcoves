import { mount } from "@vue/test-utils";
import LibraryTabs from "~/components/LibraryTabs.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  RouterLink: {
    template: '<a :href="to" :class="$attrs.class"><slot /></a>',
    props: ["to"],
  },
};

const mocks = vi.hoisted(() => ({
  routePath: "/libraries/lib-1",
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({ path: mocks.routePath, meta: {} }),
  };
});
vi.mock("#imports", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({ path: mocks.routePath, meta: {} }),
  };
});

describe("LibraryTabs", () => {
  beforeEach(() => {
    mocks.routePath = "/libraries/lib-1";
  });

  function mountTabs(props: Record<string, unknown> = {}) {
    return mount(LibraryTabs, {
      props: { libraryId: "lib-1", ...props },
      global: { stubs },
    });
  }

  it("renders Files and Tags tabs by default", () => {
    const wrapper = mountTabs();
    expect(wrapper.text()).toContain("Files");
    expect(wrapper.text()).toContain("Tags");
    expect(wrapper.text()).toContain("Trash");
  });

  it("does not render People tab by default", () => {
    const wrapper = mountTabs();
    expect(wrapper.text()).not.toContain("People");
  });

  it("renders People tab when faceRecognitionEnabled", () => {
    const wrapper = mountTabs({ faceRecognitionEnabled: true });
    expect(wrapper.text()).toContain("People");
  });

  it("does not render Settings tab by default", () => {
    const wrapper = mountTabs();
    expect(wrapper.text()).not.toContain("Settings");
  });

  it("renders Settings tab when canManageLibrary", () => {
    const wrapper = mountTabs({ canManageLibrary: true });
    expect(wrapper.text()).toContain("Settings");
  });

  it("marks Files tab active on library root path", () => {
    mocks.routePath = "/libraries/lib-1";
    const wrapper = mountTabs();
    const tabs = wrapper.findAll("[role='tab']");
    const filesTab = tabs.find((t) => t.text().includes("Files"));
    expect(filesTab?.classes().join(" ")).toMatch(/text-primary/);
  });

  it.skip("marks Tags tab active on tags path", () => {
    mocks.routePath = "/libraries/lib-1/tags";
    const wrapper = mountTabs();
    const tabs = wrapper.findAll("[role='tab']");
    const tagsTab = tabs.find((t) => t.text().includes("Tags"));
    expect(tagsTab?.classes().join(" ")).toMatch(/text-primary/);
  });

  it.skip("marks Trash tab active on trash path", () => {
    mocks.routePath = "/libraries/lib-1/trash";
    const wrapper = mountTabs();
    const tabs = wrapper.findAll("[role='tab']");
    const trashTab = tabs.find((t) => t.text().includes("Trash"));
    expect(trashTab?.classes().join(" ")).toMatch(/text-primary/);
  });

  it.skip("marks Settings tab active on settings path", () => {
    mocks.routePath = "/libraries/lib-1/settings";
    const wrapper = mountTabs({ canManageLibrary: true });
    const tabs = wrapper.findAll("[role='tab']");
    const settingsTab = tabs.find((t) => t.text().includes("Settings"));
    expect(settingsTab?.classes().join(" ")).toMatch(/text-primary/);
  });

  it.skip("marks People tab active on people path", () => {
    mocks.routePath = "/libraries/lib-1/people";
    const wrapper = mountTabs({ faceRecognitionEnabled: true });
    const tabs = wrapper.findAll("[role='tab']");
    const peopleTab = tabs.find((t) => t.text().includes("People"));
    expect(peopleTab?.classes().join(" ")).toMatch(/text-primary/);
  });

  it("generates correct tab links", () => {
    const wrapper = mountTabs({ canManageLibrary: true, faceRecognitionEnabled: true });
    const links = wrapper.findAll("a");
    const hrefs = links.map((l) => l.attributes("href"));
    expect(hrefs).toContain("/libraries/lib-1");
    expect(hrefs).toContain("/libraries/lib-1/tags");
    expect(hrefs).toContain("/libraries/lib-1/feed");
    expect(hrefs).toContain("/libraries/lib-1/people");
    expect(hrefs).toContain("/libraries/lib-1/trash");
    expect(hrefs).toContain("/libraries/lib-1/settings");
  });

  it("includes Feed tab by default", () => {
    const wrapper = mountTabs();
    expect(wrapper.text()).toContain("Feed");
  });

  it("renders actions slot", () => {
    const wrapper = mount(LibraryTabs, {
      props: { libraryId: "lib-1" },
      global: { stubs },
      slots: { actions: "<button>Upload</button>" },
    });
    expect(wrapper.text()).toContain("Upload");
  });
});
