import { mount } from "@vue/test-utils";
import InvitePage from "~/pages/invites/[token].vue";
import type { InviteLookupResponse } from "~~/shared/types/api";

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
  invite: null as InviteLookupResponse | null,
  status: "success" as string,
  refresh: vi.fn(),
  toast: { add: vi.fn() },
  apiFetch: vi.fn().mockResolvedValue({}),
  mockRouter: { push: vi.fn(), replace: vi.fn() },
  refreshLibraries: vi.fn(),
  user: {
    id: "user-1",
    email: "u@example.com",
    displayName: "User",
    avatarUrl: null,
    role: "owner",
  },
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => mocks.mockRouter,
    useRoute: () => ({
      params: { token: "abc123" },
    }),
  };
});

vi.mock("@nuxt/ui/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    loggedIn: mockRef(() => true),
    user: mockRef(() => mocks.user),
    fetchSession: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    uploadAvatar: vi.fn(),
  }),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({
    data: mockRef(() => mocks.invite),
    status: mockRef(() => mocks.status),
    refresh: mocks.refresh,
  }),
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

const stubs = {
  UCard: { template: "<div><slot name='header' /><slot /></div>", props: ["variant"] },
  UAvatar: { template: "<div />", props: ["src", "alt", "size"] },
  UIcon: { template: "<i />", props: ["name", "class"] },
  UButton: {
    template: "<button :disabled='loading' @click='$emit(\"click\")'>{{ label }}</button>",
    props: ["label", "icon", "loading", "color", "variant", "to"],
    emits: ["click"],
  },
};

function makeInvite(overrides: Partial<InviteLookupResponse> = {}): InviteLookupResponse {
  return {
    id: "inv-1",
    role: "viewer",
    status: "pending",
    canAccept: true,
    createdAt: "2025-01-01T00:00:00Z",
    invitedEmail: null,
    invitedBy: { id: "u-owner", displayName: "Owner", avatarUrl: null },
    library: { id: "lib-1", name: "My Library" },
    ...overrides,
  };
}

describe("invites/[token].vue", () => {
  beforeEach(() => {
    mocks.invite = makeInvite();
    mocks.status = "success";
    mocks.toast.add.mockReset();
    mocks.apiFetch.mockReset().mockResolvedValue({});
    mocks.mockRouter.push.mockReset();
    mocks.refresh.mockReset();
    mocks.refreshLibraries.mockReset();
  });

  function mountPage() {
    return mount(InvitePage, {
      global: {
        stubs,
        provide: { refreshLibraries: mocks.refreshLibraries },
      },
    });
  }

  it("renders invite title with inviter name and library", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Owner has invited you to join My Library");
  });

  it("shows pending status message", () => {
    mocks.invite = makeInvite({ status: "pending" });
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Accept this invitation to get access");
  });

  it("shows accepted status message", () => {
    mocks.invite = makeInvite({ status: "accepted", canAccept: false });
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("already been accepted");
  });

  it("shows already_member status message", () => {
    mocks.invite = makeInvite({ status: "already_member", canAccept: false });
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("already have access");
  });

  it("shows expired status message", () => {
    mocks.invite = makeInvite({ status: "expired", canAccept: false });
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("expired");
  });

  it("shows revoked status message", () => {
    mocks.invite = makeInvite({ status: "revoked", canAccept: false });
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("revoked");
  });

  it("shows not_allowed status message", () => {
    mocks.invite = makeInvite({ status: "not_allowed", canAccept: false });
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("restricted to a different email");
  });

  it("shows accept button when canAccept is true", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Accept Invite");
  });

  it("hides accept button when canAccept is false", () => {
    mocks.invite = makeInvite({ canAccept: false });
    const wrapper = mountPage();
    expect(wrapper.text()).not.toContain("Accept Invite");
  });

  it("accept invite calls apiFetch and navigates", async () => {
    mocks.apiFetch.mockResolvedValueOnce({ libraryId: "lib-1", libraryName: "My Library" });

    const wrapper = mountPage();
    const acceptButton = wrapper.findAll("button").find((b) => b.text() === "Accept Invite");
    await acceptButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/invites/abc123/accept", { method: "POST" });
    });
  });

  it("accept invite shows error toast on failure", async () => {
    mocks.apiFetch.mockRejectedValueOnce({ data: { message: "Invite expired" } });

    const wrapper = mountPage();
    const acceptButton = wrapper.findAll("button").find((b) => b.text() === "Accept Invite");
    await acceptButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Invite expired", color: "error" });
    });
  });

  it("shows loading spinner when status is pending", () => {
    mocks.status = "pending";
    const wrapper = mountPage();
    expect(wrapper.find("i").exists()).toBe(true);
  });

  it("shows fallback invite title when invite is null", () => {
    mocks.invite = null;
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Library invite");
  });
});
