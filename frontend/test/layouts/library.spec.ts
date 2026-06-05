import { mount } from "@vue/test-utils";
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
    loggedIn: { value: true },
    fetchSession: vi.fn().mockResolvedValue(null),
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
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
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
      meta: {},
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
  props: ["libraryId", "name", "emoji"],
  template: "<div data-stub='header'><slot /></div>",
});

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  LibraryHeader: LibraryHeaderStub,
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

  it("always shows the header across library routes", () => {
    for (const path of [
      "/libraries/lib-1",
      "/libraries/lib-1/trash",
      "/libraries/lib-1/settings",
      "/libraries/lib-1/people",
    ]) {
      mocks.routePath = path;
      const wrapper = mountLayout();
      expect(wrapper.find("[data-stub='header']").exists()).toBe(true);
    }
  });

  it.skip("renders router view slot", () => {
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("Page Content");
  });
});
