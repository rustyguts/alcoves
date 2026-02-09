import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import SettingsPage from "~/pages/settings.vue";

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
  users: [
    {
      id: "u1",
      email: "admin@example.com",
      displayName: "Admin User",
      avatarUrl: null,
      role: "owner",
      createdAt: "2025-01-15T00:00:00Z",
    },
    {
      id: "u2",
      email: "user@example.com",
      displayName: "Regular User",
      avatarUrl: "https://example.com/avatar.jpg",
      role: "user",
      createdAt: "2025-03-20T00:00:00Z",
    },
  ],
  status: "success" as string,
  user: {
    id: "user-1",
    email: "u@example.com",
    displayName: "User",
    avatarUrl: null,
    role: "owner",
  },
}));

mockNuxtImport("useFetch", () => () => ({
  data: mockRef(() => mocks.users),
  status: mockRef(() => mocks.status),
}));

mockNuxtImport("useUserSession", () => () => ({
  loggedIn: mockRef(() => true),
  user: mockRef(() => mocks.user),
  fetch: vi.fn().mockResolvedValue(null),
  clear: vi.fn(),
}));

const stubs = {
  UTable: {
    template:
      "<table><tr v-for='row in data' :key='row.id'><td>{{ row.displayName }}</td><td>{{ row.email }}</td></tr></table>",
    props: ["data", "columns"],
  },
  UBadge: {
    template: "<span><slot>{{ label }}</slot></span>",
    props: ["label", "color", "variant", "size"],
  },
  UIcon: { template: "<i />", props: ["name", "class"] },
  UAvatar: { template: "<div />", props: ["src", "alt", "size"] },
};

describe("settings.vue", () => {
  beforeEach(() => {
    mocks.status = "success";
  });

  async function mountPage() {
    return mountSuspended(SettingsPage, { global: { stubs } });
  }

  it("renders settings page with title", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Settings");
    expect(wrapper.text()).toContain("Server administration settings");
  });

  it("renders user list when loaded", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Admin User");
    expect(wrapper.text()).toContain("Regular User");
    expect(wrapper.text()).toContain("2 users");
  });

  it("renders Users header", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Users");
  });
});
