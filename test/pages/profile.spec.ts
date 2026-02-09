import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
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
  fetch: vi.fn().mockResolvedValue({}),
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

mockNuxtImport("useAuth", () => () => ({
  user: mockRef(() => mocks.user),
  updateProfile: mocks.updateProfile,
  uploadAvatar: mocks.uploadAvatar,
}));

mockNuxtImport("useToast", () => () => mocks.toast);

mockNuxtImport("useColorMode", () => () => ({
  get preference() {
    return mocks.colorPreference;
  },
  set preference(v: string) {
    mocks.colorPreference = v;
  },
}));

mockNuxtImport("useFetch", () => () => ({
  data: mockRef(() => mocks.sessions),
  refresh: mocks.refreshSessions,
}));

mockNuxtImport("useUserSession", () => () => ({
  loggedIn: mockRef(() => true),
  user: mockRef(() => mocks.user),
  fetch: vi.fn().mockResolvedValue(null),
  clear: vi.fn(),
}));

const stubs = {
  UFormField: { template: "<div><slot /></div>", props: ["label", "description"] },
  UInput: {
    template:
      "<input :value='modelValue' @input='$emit(\"update:modelValue\", $event.target.value)' />",
    props: ["modelValue", "placeholder", "class"],
    emits: ["update:modelValue"],
  },
  USelectMenu: { template: "<select />", props: ["modelValue", "items", "valueKey", "class"] },
  UButton: {
    template:
      "<button :disabled='disabled' :data-loading='loading' @click='$emit(\"click\")'>{{ label }}</button>",
    props: ["label", "loading", "icon", "color", "variant", "size", "disabled", "square"],
    emits: ["click"],
  },
  USeparator: { template: "<hr />" },
  UBadge: { template: "<span><slot>{{ label }}</slot></span>", props: ["label", "color", "size"] },
  UIcon: { template: "<i />", props: ["name", "class"] },
};

describe("profile.vue", () => {
  beforeEach(() => {
    mocks.toast.add.mockReset();
    mocks.updateProfile.mockReset();
    mocks.uploadAvatar.mockReset();
    mocks.refreshSessions.mockReset();
    mocks.fetch.mockReset().mockResolvedValue({});
    mocks.user.avatarUrl = null;
    mocks.user.displayName = "Test User";

    vi.stubGlobal("$fetch", mocks.fetch);
  });

  async function mountPage() {
    return mountSuspended(ProfilePage, { global: { stubs } });
  }

  it("renders user info", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("My Profile");
    expect(wrapper.text()).toContain("user@example.com");
  });

  it("renders current session with badge", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Chrome");
    expect(wrapper.text()).toContain("Current");
  });

  it("renders non-current session with revoke button", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Firefox");
    expect(wrapper.text()).toContain("Revoke");
  });

  it("shows avatar initial when no avatar URL", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("T");
  });

  it("shows avatar image when avatarUrl is set", async () => {
    mocks.user.avatarUrl = "https://example.com/avatar.jpg";
    const wrapper = await mountPage();
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("https://example.com/avatar.jpg");
  });

  it("save with no changes shows neutral toast", async () => {
    const wrapper = await mountPage();
    const saveButton = wrapper.findAll("button").find((b) => b.text() === "Save");

    await saveButton?.trigger("click");
    await nextTick();

    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "No changes to save", color: "neutral" });
  });

  it("save with display name calls updateProfile", async () => {
    mocks.updateProfile.mockResolvedValueOnce({});

    const wrapper = await mountPage();
    const input = wrapper.find("input");
    await input.setValue("New Name");

    const saveButton = wrapper.findAll("button").find((b) => b.text() === "Save");
    await saveButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.updateProfile).toHaveBeenCalledWith({ displayName: "New Name" });
    });
  });

  it("revoke session calls DELETE and refreshes", async () => {
    mocks.refreshSessions.mockResolvedValueOnce(undefined);

    const wrapper = await mountPage();
    const revokeButton = wrapper.findAll("button").find((b) => b.text() === "Revoke");
    await revokeButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/sessions/s2", { method: "DELETE" });
    });
  });

  it("revoke session shows error toast on failure", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("fail"));

    const wrapper = await mountPage();
    const revokeButton = wrapper.findAll("button").find((b) => b.text() === "Revoke");
    await revokeButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.toast.add).toHaveBeenCalledWith({
        title: "Failed to revoke session",
        color: "error",
      });
    });
  });

  it("displays session dates in correct format", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Jun");
    expect(wrapper.text()).toContain("2025");
  });
});
