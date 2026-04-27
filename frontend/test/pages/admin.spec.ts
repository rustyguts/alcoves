import { mount } from "@vue/test-utils";
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
    users: 2,
    libraries: 3,
    files: 100,
    folders: 8,
    totalSize: 1024 * 1024 * 500,
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
    },
    {
      id: "user-2",
      email: "member@example.com",
      displayName: "Member User",
      avatarUrl: null,
      role: "member" as const,
      createdAt: "2025-02-01T00:00:00Z",
      updatedAt: "2025-02-01T00:00:00Z",
    },
  ],
  toast: { add: vi.fn() },
  apiFetch: vi.fn().mockResolvedValue({}),
  currentUser: { id: "user-1", role: "owner" },
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: (url: string) => {
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
  },
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: mockRef(() => mocks.currentUser),
    loggedIn: { value: true },
    fetchSession: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

describe("admin.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountPage() {
    return mount(AdminPage, {
      global: {
        stubs: {
          AdminJobsPanel: { template: "<div>Jobs panel</div>" },
          UserAvatar: { template: "<div />" },
          AppIcon: { template: "<svg />" },
        },
      },
    });
  }

  it("renders the admin heading", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Admin Dashboard");
    expect(wrapper.text()).toContain("Instance overview, user management, and background jobs.");
  });

  it("displays stat cards with correct values", () => {
    const wrapper = mountPage();
    const text = wrapper.text();
    expect(text).toContain("Files");
    expect(text).toContain("100");
    expect(text).toContain("Storage");
    expect(text).toContain("500 MB");
    expect(text).toContain("Libraries");
    expect(text).toContain("3");
    expect(text).toContain("Users");
    expect(text).toContain("2");
    expect(text).toContain("Folders");
    expect(text).toContain("8");
  });

  it("shows user management section with column headers", () => {
    const wrapper = mountPage();
    const text = wrapper.text();
    expect(text).toContain("Users");
    expect(text).toContain("User");
    expect(text).toContain("Role");
    expect(text).toContain("Joined");
  });

  it("displays user count badge", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("2");
  });
});
