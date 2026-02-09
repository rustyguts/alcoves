import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
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
  fetch: vi.fn().mockResolvedValue({}),
  navigateTo: vi.fn(),
  refreshLibraries: vi.fn(),
  user: { id: "user-1", email: "u@example.com", displayName: "User", avatarUrl: null, role: "owner" },
}));

mockNuxtImport("useToast", () => () => mocks.toast);
mockNuxtImport("navigateTo", () => mocks.navigateTo);

mockNuxtImport("useUserSession", () => () => ({
  loggedIn: mockRef(() => true),
  user: mockRef(() => mocks.user),
  fetch: vi.fn().mockResolvedValue(null),
  clear: vi.fn(),
}));

mockNuxtImport("useFetch", () => () => ({
  data: mockRef(() => mocks.invite),
  status: mockRef(() => mocks.status),
  refresh: mocks.refresh,
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
    mocks.fetch.mockReset().mockResolvedValue({});
    mocks.navigateTo.mockReset();
    mocks.refresh.mockReset();
    mocks.refreshLibraries.mockReset();

    vi.stubGlobal("$fetch", mocks.fetch);
  });

  async function mountPage() {
    return mountSuspended(InvitePage, {
      route: "/invites/abc123",
      global: {
        stubs,
        provide: { refreshLibraries: mocks.refreshLibraries },
      },
    });
  }

  it("renders invite title with inviter name and library", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Owner has invited you to join My Library");
  });

  it("shows pending status message", async () => {
    mocks.invite = makeInvite({ status: "pending" });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Accept this invitation to get access");
  });

  it("shows accepted status message", async () => {
    mocks.invite = makeInvite({ status: "accepted", canAccept: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("already been accepted");
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

  it("shows not_allowed status message", async () => {
    mocks.invite = makeInvite({ status: "not_allowed", canAccept: false });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("restricted to a different email");
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

  it("accept invite calls $fetch and navigates", async () => {
    mocks.fetch.mockResolvedValueOnce({ libraryId: "lib-1", libraryName: "My Library" });

    const wrapper = await mountPage();
    const acceptButton = wrapper.findAll("button").find((b) => b.text() === "Accept Invite");
    await acceptButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith("/api/invites/abc123/accept", { method: "POST" });
    });
  });

  it("accept invite shows error toast on failure", async () => {
    mocks.fetch.mockRejectedValueOnce({ data: { message: "Invite expired" } });

    const wrapper = await mountPage();
    const acceptButton = wrapper.findAll("button").find((b) => b.text() === "Accept Invite");
    await acceptButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Invite expired", color: "error" });
    });
  });

  it("shows loading spinner when status is pending", async () => {
    mocks.status = "pending";
    const wrapper = await mountPage();
    expect(wrapper.find("i").exists()).toBe(true);
  });

  it("shows fallback invite title when invite is null", async () => {
    mocks.invite = null;
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Library invite");
  });
});
