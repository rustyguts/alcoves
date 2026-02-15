import { mount } from "@vue/test-utils";
import DashboardLayout from "~/layouts/dashboard.vue";

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
  user: {
    id: "user-1",
    email: "user@example.com",
    displayName: "Test User",
    avatarUrl: null as string | null,
    role: "owner",
  },
  logout: vi.fn(),
  libraries: [
    {
      id: "lib-default",
      name: "My Files",
      emoji: null as string | null,
      isDefault: true,
      ownerId: "user-1",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "lib-2",
      name: "Projects",
      emoji: null as string | null,
      isDefault: false,
      ownerId: "user-1",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "lib-3",
      name: "Archives",
      emoji: null as string | null,
      isDefault: false,
      ownerId: "user-1",
      createdAt: "",
      updatedAt: "",
    },
  ],
  refreshLibraries: vi.fn(),
  routerPush: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: mockRef(() => mocks.user),
    logout: mocks.logout,
  }),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({
    data: mockRef(() => mocks.libraries),
    refresh: mocks.refreshLibraries,
  }),
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => ({
      push: mocks.routerPush,
      replace: vi.fn(),
      currentRoute: { value: { path: "/", query: {} } },
    }),
    useRoute: () => ({
      path: "/",
      query: {},
      params: {},
      fullPath: "/",
    }),
  };
});

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

describe("dashboard.vue", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset().mockResolvedValue({});
    mocks.routerPush.mockReset();
    mocks.refreshLibraries.mockReset();
    mocks.user.avatarUrl = null;
    mocks.user.role = "owner";
  });

  function mountLayout() {
    return mount(DashboardLayout, {
      global: { stubs },
    });
  }

  it("renders sidebar with app name", () => {
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("Alcoves");
  });

  it("renders default library in navigation", () => {
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("My Files");
  });

  it("renders non-default libraries in navigation", () => {
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("Projects");
    expect(wrapper.text()).toContain("Archives");
  });

  it("renders Libraries header", () => {
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("Libraries");
  });

  it("shows Admin link for owners", () => {
    mocks.user.role = "owner";
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("Admin");
  });

  it("hides Settings link for non-owners", () => {
    mocks.user.role = "viewer";
    const wrapper = mountLayout();
    expect(wrapper.text()).not.toContain("Settings");
  });

  it("displays user initial in avatar placeholder", () => {
    mocks.user.avatarUrl = null;
    const wrapper = mountLayout();
    const allText = wrapper.text();
    expect(allText).toContain("T");
  });

  it("sidebar nav elements have w-full class", () => {
    const wrapper = mountLayout();
    const navElements = wrapper.findAll("nav");
    expect(navElements.length).toBeGreaterThanOrEqual(2);
    for (const nav of navElements) {
      expect(nav.classes()).toContain("w-full");
    }
  });

  it("content container has padding class", () => {
    const wrapper = mountLayout();
    const contentDiv = wrapper.find(".drawer-content .p-4");
    expect(contentDiv.exists()).toBe(true);
  });

  it("shows emoji instead of icon when library has emoji set", () => {
    mocks.libraries[1]!.emoji = "\u{1F680}";
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("\u{1F680}");
    mocks.libraries[1]!.emoji = null;
  });

  it("sidebar nav uses standard menu size (not menu-sm)", () => {
    const wrapper = mountLayout();
    const navElements = wrapper.findAll("nav");
    for (const nav of navElements) {
      expect(nav.classes()).not.toContain("menu-sm");
    }
  });
});
