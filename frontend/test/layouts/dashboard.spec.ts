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
      isDefault: true,
      ownerId: "user-1",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "lib-2",
      name: "Projects",
      isDefault: false,
      ownerId: "user-1",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "lib-3",
      name: "Archives",
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
  DashboardGroup: { template: "<div><slot /></div>" },
  DashboardSidebar: {
    template:
      "<div><slot name='header' :collapsed='false' /><slot :collapsed='false' /><slot name='footer' /></div>",
    props: ["collapsible", "resizable", "ui"],
  },
  DashboardSidebarCollapse: { template: "<div />" },
  DashboardPanel: { template: "<div><slot name='header' /><slot name='body' /></div>" },
  DashboardNavbar: { template: "<div><slot name='left' /><slot name='right' /></div>" },
  NavigationMenu: {
    template: "<nav><span v-for='item in items' :key='item.label'>{{ item.label }}</span></nav>",
    props: ["items", "collapsed", "orientation"],
  },
  Separator: { template: "<hr />" },
  Button: {
    template: "<button @click='$emit(\"click\")'><slot>{{ label }}</slot></button>",
    props: ["icon", "size", "color", "variant", "square", "label", "class"],
    emits: ["click"],
  },
  Input: {
    template:
      "<input :value='modelValue' @input='$emit(\"update:modelValue\", $event.target.value)' />",
    props: [
      "modelValue",
      "type",
      "autocomplete",
      "enterkeyhint",
      "leadingIcon",
      "placeholder",
      "variant",
      "size",
      "class",
    ],
    emits: ["update:modelValue"],
  },
  DropdownMenu: { template: "<div><slot /></div>", props: ["items"] },
  Icon: { template: "<i />", props: ["name", "class"] },
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
});
