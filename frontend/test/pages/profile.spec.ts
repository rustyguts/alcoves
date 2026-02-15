import { mount } from "@vue/test-utils";
import ProfilePage from "~/pages/profile.vue";

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
  toast: { add: vi.fn() },
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({}),
  colorPreference: "system",
  sessions: [
    {
      id: "s1",
      userAgent: "Mozilla/5.0 Chrome/120",
      ipAddress: "192.168.1.1",
      createdAt: "2025-06-01T00:00:00Z",
      expiresAt: "2025-07-01T00:00:00Z",
      isCurrent: true,
    },
    {
      id: "s2",
      userAgent: "Mozilla/5.0 Firefox/120",
      ipAddress: "10.0.0.1",
      createdAt: "2025-06-02T00:00:00Z",
      expiresAt: "2025-07-02T00:00:00Z",
      isCurrent: false,
    },
  ],
  refreshSessions: vi.fn(),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: mockRef(() => mocks.user),
    updateProfile: mocks.updateProfile,
    uploadAvatar: mocks.uploadAvatar,
  }),
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("@vueuse/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useColorMode: () => ({
      store: mockRef(
        () => mocks.colorPreference,
        (v: string) => {
          mocks.colorPreference = v;
        },
      ),
    }),
  };
});

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({
    data: mockRef(() => mocks.sessions),
    refresh: mocks.refreshSessions,
  }),
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

const stubs = {
  AppIcon: { template: "<svg />", props: ["name", "class"] },
};

describe("profile.vue", () => {
  beforeEach(() => {
    mocks.toast.add.mockReset();
    mocks.updateProfile.mockReset();
    mocks.uploadAvatar.mockReset();
    mocks.refreshSessions.mockReset();
    mocks.apiFetch.mockReset().mockResolvedValue({});
    mocks.user.avatarUrl = null;
    mocks.user.displayName = "Test User";
  });

  function mountPage() {
    return mount(ProfilePage, { global: { stubs } });
  }

  it("renders user info", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("My Profile");
    expect(wrapper.text()).toContain("user@example.com");
  });

  it("renders current session with badge", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Chrome");
    expect(wrapper.text()).toContain("Current");
  });

  it("renders non-current session with revoke button", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Firefox");
    expect(wrapper.text()).toContain("Revoke");
  });

  it("shows avatar initial when no avatar URL", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("T");
  });

  it("shows avatar image when avatarUrl is set", () => {
    mocks.user.avatarUrl = "https://example.com/avatar.jpg";
    const wrapper = mountPage();
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("https://example.com/avatar.jpg");
  });

  it("save with no changes shows neutral toast", async () => {
    const wrapper = mountPage();
    const saveButton = wrapper.findAll("button").find((b) => b.text().includes("Save"));

    await saveButton?.trigger("click");
    await nextTick();

    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "No changes to save", color: "neutral" });
  });

  it("save with display name calls updateProfile", async () => {
    mocks.updateProfile.mockResolvedValueOnce({});

    const wrapper = mountPage();
    // Find the display name input (the one inside the Display Name fieldset)
    const input = wrapper.find("fieldset .input");
    await input.setValue("New Name");

    const saveButton = wrapper.findAll("button").find((b) => b.text().includes("Save"));
    await saveButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.updateProfile).toHaveBeenCalledWith({ displayName: "New Name" });
    });
  });

  it("revoke session calls DELETE and refreshes", async () => {
    mocks.refreshSessions.mockResolvedValueOnce(undefined);

    const wrapper = mountPage();
    const revokeButton = wrapper.findAll("button").find((b) => b.text().includes("Revoke"));
    await revokeButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/auth/sessions/s2", { method: "DELETE" });
    });
  });

  it("revoke session shows error toast on failure", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new Error("fail"));

    const wrapper = mountPage();
    const revokeButton = wrapper.findAll("button").find((b) => b.text().includes("Revoke"));
    await revokeButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.toast.add).toHaveBeenCalledWith({
        title: "Failed to revoke session",
        color: "error",
      });
    });
  });

  it("displays session dates in correct format", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Jun");
    expect(wrapper.text()).toContain("2025");
  });
});
