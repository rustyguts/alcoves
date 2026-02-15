import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import AdminPage from "~/pages/admin/index.vue";

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
  stats: {
    totalFiles: 100,
    totalSizeBytes: 1024 * 1024 * 500,
    averageFileSizeBytes: 1024 * 1024 * 5,
    totalLibraries: 3,
    totalUsers: 2,
  },
  users: [
    {
      id: "user-1",
      email: "owner@example.com",
      displayName: "Owner User",
      avatarUrl: null,
      role: "owner" as const,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      lastLoggedInAt: "2025-06-01T00:00:00Z",
      uploadedFileCount: 50,
      uploadedSizeBytes: 1024 * 1024 * 200,
    },
    {
      id: "user-2",
      email: "member@example.com",
      displayName: "Member User",
      avatarUrl: null,
      role: "member" as const,
      createdAt: "2025-02-01T00:00:00Z",
      updatedAt: "2025-02-01T00:00:00Z",
      lastLoggedInAt: null,
      uploadedFileCount: 50,
      uploadedSizeBytes: 1024 * 1024 * 300,
    },
  ],
  toast: { add: vi.fn() },
  fetch: vi.fn().mockResolvedValue({}),
  currentUser: { id: "user-1", role: "owner" },
}));

mockNuxtImport("useFetch", () => (url: string) => {
  if (url.includes("/admin/stats")) {
    return {
      data: mockRef(() => mocks.stats),
      status: mockRef(() => "success"),
      refresh: vi.fn(),
    };
  }
  if (url.includes("/admin/users")) {
    return {
      data: mockRef(() => mocks.users),
      status: mockRef(() => "success"),
      refresh: vi.fn(),
    };
  }
  return { data: mockRef(() => null), status: mockRef(() => "idle"), refresh: vi.fn() };
});

mockNuxtImport("useToast", () => () => mocks.toast);
mockNuxtImport("useAuth", () => () => ({
  user: mockRef(() => mocks.currentUser),
}));

describe("admin.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("$fetch", mocks.fetch);
  });

  async function mountPage() {
    return mountSuspended(AdminPage);
  }

  it("renders the admin heading", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Admin");
    expect(wrapper.text()).toContain("Instance-wide metrics");
  });

  it("displays stat cards with correct values", async () => {
    const wrapper = await mountPage();
    const text = wrapper.text();
    expect(text).toContain("Total Files");
    expect(text).toContain("100");
    expect(text).toContain("Total Storage");
    expect(text).toContain("500 MB");
    expect(text).toContain("Libraries");
    expect(text).toContain("3");
    expect(text).toContain("Users");
    expect(text).toContain("2");
  });

  it("shows user management table with user data", async () => {
    const wrapper = await mountPage();
    const text = wrapper.text();
    expect(text).toContain("User Management");
    expect(text).toContain("Owner User");
    expect(text).toContain("owner@example.com");
    expect(text).toContain("Member User");
    expect(text).toContain("member@example.com");
  });

  it("displays user count badge", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("2 users");
  });

  it("shows 'Never' for users with null lastLoggedInAt", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Never");
  });
});
