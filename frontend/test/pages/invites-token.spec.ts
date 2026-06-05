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
  navigateTo: vi.fn(),
  fetchSession: vi.fn().mockResolvedValue(null),
  loggedIn: true,
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
      meta: {},
    }),
    RouterLink: { template: "<a><slot /></a>", props: ["to"] },
  };
});

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));
vi.mock("#imports", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => mocks.mockRouter,
    useRoute: () => ({
      params: { token: "abc123" },
      meta: {},
    }),
    navigateTo: (...args: unknown[]) => mocks.navigateTo(...args),
    RouterLink: { template: "<a><slot /></a>", props: ["to"] },
  };
});

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    loggedIn: mockRef(() => mocks.loggedIn),
    user: mockRef(() => mocks.user),
    fetchSession: mocks.fetchSession,
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
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

const stubs = {
  AppIcon: { template: "<svg />", props: ["name", "class"] },
};

function makeInvite(overrides: Partial<InviteLookupResponse> = {}): InviteLookupResponse {
  return {
    id: "inv-1",
    status: "pending",
    canAccept: true,
    createdAt: "2025-01-01T00:00:00Z",
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    invitedBy: { id: "u-owner", displayName: "Owner", avatarUrl: null },
    library: { id: "lib-1", name: "My Library" },
    ...overrides,
  };
}

async function mountPage() {
  const wrapper = mount(InvitePage, {
    global: {
      stubs,
      provide: { refreshLibraries: mocks.refreshLibraries },
    },
  });
  await flushPromises();
  return wrapper;
}

async function flushPromises() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("invites/[token].vue", () => {
  beforeEach(() => {
    mocks.invite = makeInvite();
    mocks.status = "success";
    mocks.loggedIn = true;
    mocks.toast.add.mockReset();
    mocks.apiFetch.mockReset().mockResolvedValue({});
    mocks.mockRouter.push.mockReset();
    mocks.refresh.mockReset();
    mocks.refreshLibraries.mockReset();
    mocks.navigateTo.mockReset();
    mocks.fetchSession.mockReset().mockResolvedValue(null);
  });

  it("renders invite title with inviter name and library", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Owner has invited you to join My Library");
  });

  it("shows pending status message", async () => {
    mocks.invite = makeInvite({ status: "pending" });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Accept this invitation to get access");
  });

  it("shows already_member status message", async () => {
    mocks.invite = makeInvite({ status: "already_member", canAccept: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("already have access");
  });

  it("shows expired status message", async () => {
    mocks.invite = makeInvite({ status: "expired", canAccept: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("expired");
  });

  it("shows revoked status message", async () => {
    mocks.invite = makeInvite({ status: "revoked", canAccept: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("revoked");
  });

  it("shows exhausted status message", async () => {
    mocks.invite = makeInvite({ status: "exhausted", canAccept: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("maximum number of uses");
  });

  it("shows accept button when canAccept is true", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Accept Invite");
  });

  it("hides accept button when canAccept is false", async () => {
    mocks.invite = makeInvite({ canAccept: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).not.toContain("Accept Invite");
  });

  // Skipped: Nuxt's auto-imported `navigateTo` resolves from
  // `#app/composables/router`, which our `#imports` mock does not
  // intercept. Same limitation tracked for `useRoute` in docs/todos.md item 9.
  it.skip("redirects anon visitors to register with invite token", async () => {
    mocks.loggedIn = false;
    await mountPage();
    expect(mocks.navigateTo).toHaveBeenCalledWith({
      path: "/register",
      query: { invite: "abc123" },
    });
  });

  it("accept invite shows error toast on failure", async () => {
    mocks.apiFetch.mockRejectedValueOnce({ data: { message: "Invite expired" } });

    const wrapper = await mountPage();
    const acceptButton = wrapper.findAll("button").find((b) => b.text().includes("Accept Invite"));
    await acceptButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Invite expired", color: "error" });
    });
  });

  it("shows loading spinner when status is pending", async () => {
    mocks.status = "pending";
    const wrapper = await mountPage();
    expect(wrapper.find("[data-icon='i-lineicons-spinner-solid']").exists()).toBe(true);
  });

  it("shows fallback invite title when invite is null", async () => {
    mocks.invite = null;
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Library invite");
  });
});
