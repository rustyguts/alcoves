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
  UIcon: { template: "<i />", props: ["name"] },
  UInput: { template: "<input />", props: ["modelValue", "placeholder", "icon", "size", "type"] },
  UButton: {
    template: "<button><slot /></button>",
    props: ["color", "variant", "size", "icon", "square", "to"],
  },
  UAvatar: {
    template: "<div class='avatar'><slot /></div>",
    props: ["src", "alt", "text", "size"],
  },
  UNavigationMenu: {
    template: `<nav class="w-full"><a v-for="i in items" :key="i.label" :href="typeof i.to === 'string' ? i.to : '#'">{{ i.label }}</a></nav>`,
    props: ["items", "orientation", "variant"],
  },
  UDropdownMenu: {
    template: "<div class='dropdown'><slot /></div>",
    props: ["items", "content", "ui"],
  },
  USlideover: {
    template: "<div v-if='open'><slot name='content' /></div>",
    props: ["open", "side", "ui"],
  },
  USeparator: { template: "<hr />", props: ["label"] },
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

  it("hides Admin link for non-owners", () => {
    mocks.user.role = "viewer";
    const wrapper = mountLayout();
    expect(wrapper.text()).not.toContain("Admin");
  });

  it("shows emoji when library has emoji set", () => {
    mocks.libraries[1]!.emoji = "\u{1F680}";
    const wrapper = mountLayout();
    expect(wrapper.text()).toContain("\u{1F680}");
    mocks.libraries[1]!.emoji = null;
  });
});
