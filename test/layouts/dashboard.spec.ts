import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
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
  navigateTo: vi.fn(),
  fetch: vi.fn().mockResolvedValue({}),
}));

mockNuxtImport("useAuth", () => () => ({
  user: mockRef(() => mocks.user),
  logout: mocks.logout,
}));

mockNuxtImport("navigateTo", () => mocks.navigateTo);

mockNuxtImport("useFetch", () => () => ({
  data: mockRef(() => mocks.libraries),
  refresh: mocks.refreshLibraries,
}));

mockNuxtImport("useUserSession", () => () => ({
  loggedIn: mockRef(() => true),
  user: mockRef(() => mocks.user),
  fetch: vi.fn().mockResolvedValue(null),
  clear: vi.fn(),
}));

const stubs = {
  UDashboardGroup: { template: "<div><slot /></div>" },
  UDashboardSidebar: {
    template:
      "<div><slot name='header' :collapsed='false' /><slot :collapsed='false' /><slot name='footer' /></div>",
    props: ["collapsible", "resizable", "ui"],
  },
  UDashboardSidebarCollapse: { template: "<div />" },
  UDashboardPanel: { template: "<div><slot name='header' /><slot name='body' /></div>" },
  UDashboardNavbar: { template: "<div><slot name='left' /><slot name='right' /></div>" },
  UNavigationMenu: {
    template: "<nav><span v-for='item in items' :key='item.label'>{{ item.label }}</span></nav>",
    props: ["items", "collapsed", "orientation"],
  },
  USeparator: { template: "<hr />" },
  UButton: {
    template: "<button @click='$emit(\"click\")'><slot>{{ label }}</slot></button>",
    props: ["icon", "size", "color", "variant", "square", "label", "class"],
    emits: ["click"],
  },
  UInput: {
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
  UDropdownMenu: { template: "<div><slot /></div>", props: ["items"] },
  UIcon: { template: "<i />", props: ["name", "class"] },
};

describe("dashboard.vue", () => {
  beforeEach(() => {
    mocks.fetch.mockReset().mockResolvedValue({});
    mocks.navigateTo.mockReset();
    mocks.refreshLibraries.mockReset();
    mocks.user.avatarUrl = null;
    mocks.user.role = "owner";

    vi.stubGlobal("$fetch", mocks.fetch);
  });

  async function mountLayout() {
    return mountSuspended(DashboardLayout, {
      global: { stubs },
    });
  }

  it("renders sidebar with app name", async () => {
    const wrapper = await mountLayout();
    expect(wrapper.text()).toContain("Alcoves");
  });

  it("renders default library in navigation", async () => {
    const wrapper = await mountLayout();
    expect(wrapper.text()).toContain("My Files");
  });

  it("renders non-default libraries in navigation", async () => {
    const wrapper = await mountLayout();
    expect(wrapper.text()).toContain("Projects");
    expect(wrapper.text()).toContain("Archives");
  });

  it("renders Libraries header", async () => {
    const wrapper = await mountLayout();
    expect(wrapper.text()).toContain("Libraries");
  });

  it("shows Settings link for owners", async () => {
    mocks.user.role = "owner";
    const wrapper = await mountLayout();
    expect(wrapper.text()).toContain("Settings");
  });

  it("hides Settings link for non-owners", async () => {
    mocks.user.role = "viewer";
    const wrapper = await mountLayout();
    expect(wrapper.text()).not.toContain("Settings");
  });

  it("displays user initial in avatar placeholder", async () => {
    mocks.user.avatarUrl = null;
    const wrapper = await mountLayout();
    const allText = wrapper.text();
    expect(allText).toContain("T");
  });
});
