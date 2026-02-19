import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import LibraryLayout from "~/layouts/library.vue";

function mockRef<T>(get: () => T, set?: (value: T) => void) {
  return {
    __v_isRef: true as const,
    get value() {
      return get();
    },
    set value(v: T) {
      set?.(v);
    },
  };
}

const mocks = vi.hoisted(() => ({
  library: {
    id: "lib-1",
    name: "Test Library",
    emoji: null as string | null,
    isDefault: false,
    faceRecognitionEnabled: true,
    ownerId: "user-1",
    currentUserRole: "owner" as "owner" | "admin" | "viewer",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  },
  user: {
    id: "user-1",
    email: "user@example.com",
    displayName: "Test User",
    avatarUrl: null,
    role: "owner",
  },
  routePath: "/libraries/lib-1/settings",
  routeParamsId: "lib-1",
  refreshLibrary: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({}),
  refreshLibraries: vi.fn(),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: mockRef(() => mocks.user),
  }),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({
    data: mockRef(() => mocks.library),
    refresh: mocks.refreshLibrary,
  }),
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({
      path: mocks.routePath,
      params: { id: mocks.routeParamsId },
      query: {},
      fullPath: mocks.routePath,
    }),
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: { value: { path: mocks.routePath, query: {} } },
    }),
  };
});

// Named stub components so findComponent works
const LibraryHeaderStub = defineComponent({
  name: "LibraryHeader",
  props: ["name", "emoji", "canEdit"],
  emits: ["update:name", "update:emoji"],
  template: "<div data-stub='header'><slot /></div>",
});

const LibraryTabsStub = defineComponent({
  name: "LibraryTabs",
  props: ["libraryId", "faceRecognitionEnabled", "objectDetectionEnabled", "canManageLibrary"],
  template: "<div data-stub='tabs' />",
});

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  LibraryHeader: LibraryHeaderStub,
  LibraryTabs: LibraryTabsStub,
  RouterView: { template: "<div data-stub='router-view'>Page Content</div>" },
  Transition: { template: "<div><slot /></div>" },
};

describe("library layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routePath = "/libraries/lib-1/settings";
    mocks.routeParamsId = "lib-1";
    mocks.library.ownerId = "user-1";
    mocks.library.currentUserRole = "owner";
    mocks.library.emoji = null;
    mocks.library.faceRecognitionEnabled = true;
  });

  function mountLayout() {
    return mount(LibraryLayout, {
      global: {
        stubs,
        provide: {
          refreshLibraries: mocks.refreshLibraries,
        },
      },
    });
  }

  it("renders LibraryHeader and passes library name via props", () => {
    const wrapper = mountLayout();
    const header = wrapper.findComponent(LibraryHeaderStub);
    expect(header.exists()).toBe(true);
    expect(header.props("name")).toBe("Test Library");
  });

  it("renders LibraryTabs and passes library id via props", () => {
    const wrapper = mountLayout();
    const tabs = wrapper.findComponent(LibraryTabsStub);
    expect(tabs.exists()).toBe(true);
    expect(tabs.props("libraryId")).toBe("lib-1");
  });

  it("passes canEdit=true when user is owner", () => {
    mocks.library.ownerId = "user-1";
    const wrapper = mountLayout();
    const header = wrapper.findComponent(LibraryHeaderStub);
    expect(header.props("canEdit")).toBe(true);
  });

  it("passes canEdit=true for admin role", () => {
    mocks.library.ownerId = "other-user";
    mocks.library.currentUserRole = "admin";
    const wrapper = mountLayout();
    const header = wrapper.findComponent(LibraryHeaderStub);
    expect(header.props("canEdit")).toBe(true);
  });

  it("passes canEdit=false for viewer role", () => {
    mocks.library.ownerId = "other-user";
    mocks.library.currentUserRole = "viewer";
    const wrapper = mountLayout();
    const header = wrapper.findComponent(LibraryHeaderStub);
    expect(header.props("canEdit")).toBe(false);
  });

  it("always shows header and tabs", () => {
    for (const path of [
      "/libraries/lib-1",
      "/libraries/lib-1/trash",
      "/libraries/lib-1/settings",
      "/libraries/lib-1/people",
    ]) {
      mocks.routePath = path;
      const wrapper = mountLayout();
      expect(wrapper.find("[data-stub='header']").exists()).toBe(true);
      expect(wrapper.find("[data-stub='tabs']").exists()).toBe(true);
    }
  });

  it("calls apiFetch on saveLibraryName event", async () => {
    const wrapper = mountLayout();
    const header = wrapper.findComponent(LibraryHeaderStub);
    header.vm.$emit("update:name", "New Name");
    await flushPromises();

    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/libraries/lib-1", {
      method: "PATCH",
      body: { name: "New Name" },
    });
  });

  it("calls apiFetch on saveLibraryEmoji event", async () => {
    const wrapper = mountLayout();
    const header = wrapper.findComponent(LibraryHeaderStub);
    header.vm.$emit("update:emoji", "\u{1F680}");
    await flushPromises();

    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/libraries/lib-1", {
      method: "PATCH",
      body: { emoji: "\u{1F680}" },
    });
  });

  it("passes faceRecognitionEnabled to LibraryTabs", () => {
    mocks.library.faceRecognitionEnabled = true;
    const wrapper = mountLayout();
    const tabs = wrapper.findComponent(LibraryTabsStub);
    expect(tabs.props("faceRecognitionEnabled")).toBe(true);
  });

  it("renders router view slot", () => {
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("Page Content");
  });
});
