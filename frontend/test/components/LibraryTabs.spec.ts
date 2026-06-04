import { mount } from "@vue/test-utils";
import LibraryTabs from "~/components/LibraryTabs.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  // Tooltip wraps the icon-only utility tabs; render just its trigger slot.
  Tooltip: { template: "<div><slot /></div>", props: ["text"] },
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

  function hrefs(wrapper: ReturnType<typeof mountTabs>) {
    return wrapper.findAll("a").map((l) => l.attributes("href"));
  }

  it("renders the browse tabs (Files, Tags, Feed) with labels", () => {
    const wrapper = mountTabs();
    expect(wrapper.text()).toContain("Files");
    expect(wrapper.text()).toContain("Tags");
    expect(wrapper.text()).toContain("Feed");
  });

  it("does not render People tab by default", () => {
    const wrapper = mountTabs();
    expect(hrefs(wrapper)).not.toContain("/libraries/lib-1/people");
  });

  it("renders People tab when faceRecognitionEnabled", () => {
    const wrapper = mountTabs({ faceRecognitionEnabled: true });
    expect(wrapper.text()).toContain("People");
    expect(hrefs(wrapper)).toContain("/libraries/lib-1/people");
  });

  it("renders Objects tab when objectDetectionEnabled", () => {
    const wrapper = mountTabs({ objectDetectionEnabled: true });
    expect(wrapper.text()).toContain("Objects");
    expect(hrefs(wrapper)).toContain("/libraries/lib-1/objects");
  });

  it("always renders the Trash utility tab as an icon-only, labelled tab", () => {
    const wrapper = mountTabs();
    const trash = wrapper.findAll("a").find((l) => l.attributes("href") === "/libraries/lib-1/trash");
    expect(trash).toBeTruthy();
    expect(trash?.attributes("aria-label")).toBe("Trash");
    expect(trash?.attributes("role")).toBe("tab");
  });

  it("does not render the Settings tab by default", () => {
    const wrapper = mountTabs();
    expect(hrefs(wrapper)).not.toContain("/libraries/lib-1/settings");
  });

  it("renders the Settings utility tab (icon-only) when canManageLibrary", () => {
    const wrapper = mountTabs({ canManageLibrary: true });
    const settings = wrapper
      .findAll("a")
      .find((l) => l.attributes("href") === "/libraries/lib-1/settings");
    expect(settings).toBeTruthy();
    expect(settings?.attributes("aria-label")).toBe("Settings");
  });

  it("marks Files tab active on library root path", () => {
    mocks.routePath = "/libraries/lib-1";
    const wrapper = mountTabs();
    const tabs = wrapper.findAll("[role='tab']");
    const filesTab = tabs.find((t) => t.text().includes("Files"));
    expect(filesTab?.classes().join(" ")).toMatch(/text-primary/);
  });

  it("generates correct tab links", () => {
    const wrapper = mountTabs({ canManageLibrary: true, faceRecognitionEnabled: true });
    const links = hrefs(wrapper);
    expect(links).toContain("/libraries/lib-1");
    expect(links).toContain("/libraries/lib-1/tags");
    expect(links).toContain("/libraries/lib-1/feed");
    expect(links).toContain("/libraries/lib-1/people");
    expect(links).toContain("/libraries/lib-1/trash");
    expect(links).toContain("/libraries/lib-1/settings");
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
