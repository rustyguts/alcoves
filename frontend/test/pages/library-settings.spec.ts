import { mount, flushPromises } from "@vue/test-utils";
import SettingsPage from "~/pages/libraries/[id]/settings.vue";

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
  library: {
    id: "lib-1",
    name: "Test Library",
    emoji: null as string | null,
    isDefault: false,
    faceRecognitionEnabled: false,
    ownerId: "user-1",
    currentUserRole: "owner" as "owner" | "admin" | "viewer",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  },
  libraryUsers: {
    libraryId: "lib-1",
    canManageUsers: true,
    members: [
      {
        id: "mem-1",
        userId: "user-1",
        role: "owner" as const,
        isOwner: true,
        createdAt: "2024-01-01",
        user: { id: "user-1", email: "owner@test.com", displayName: "Owner", avatarUrl: null },
      },
    ],
    pendingInvites: [],
  },
  user: {
    id: "user-1",
    email: "owner@test.com",
    displayName: "Owner",
    avatarUrl: null,
    role: "owner",
  },
  routeParamsId: "lib-1",
  refreshLibrary: vi.fn(),
  refreshLibraryUsers: vi.fn(),
  routerPush: vi.fn(),
  apiFetch: vi.fn().mockResolvedValue({ totalCount: 0 }),
  toast: { add: vi.fn() },
  refreshLibraries: vi.fn(),
  // useLibraryMembers return values
  memberRoleDrafts: {} as Record<string, string>,
  inviteEmail: "",
  inviteEmailRole: "viewer",
  inviteByEmailLoading: false,
  createInviteLinkLoading: false,
  updatingMemberUserId: null as string | null,
  removingMemberUserId: null as string | null,
  revokingInviteId: null as string | null,
  libraryMembers: [] as unknown[],
  emailInvites: [] as unknown[],
  inviteLinks: [] as unknown[],
  inviteRoleOptions: [
    { label: "Viewer", value: "viewer" },
    { label: "Admin", value: "admin" },
  ],
  copyInviteLink: vi.fn(),
  inviteUserByEmail: vi.fn(),
  createInviteLink: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  revokeInvite: vi.fn(),
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    user: mockRef(() => mocks.user),
  }),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: (urlFn: () => string) => {
    const url = urlFn();
    if (url.includes("/users")) {
      return { data: mockRef(() => mocks.libraryUsers), refresh: mocks.refreshLibraryUsers };
    }
    return { data: mockRef(() => mocks.library), refresh: mocks.refreshLibrary };
  },
}));

vi.mock("~/composables/useLibraryMembers", () => ({
  useLibraryMembers: () => ({
    memberRoleDrafts: mocks.memberRoleDrafts,
    inviteEmail: mockRef(
      () => mocks.inviteEmail,
      (v: string) => {
        mocks.inviteEmail = v;
      },
    ),
    inviteEmailRole: mockRef(
      () => mocks.inviteEmailRole,
      (v: string) => {
        mocks.inviteEmailRole = v;
      },
    ),
    inviteByEmailLoading: mockRef(() => mocks.inviteByEmailLoading),
    createInviteLinkLoading: mockRef(() => mocks.createInviteLinkLoading),
    updatingMemberUserId: mockRef(() => mocks.updatingMemberUserId),
    removingMemberUserId: mockRef(() => mocks.removingMemberUserId),
    revokingInviteId: mockRef(() => mocks.revokingInviteId),
    inviteRoleOptions: mocks.inviteRoleOptions,
    libraryMembers: mockRef(() => mocks.libraryMembers),
    emailInvites: mockRef(() => mocks.emailInvites),
    inviteLinks: mockRef(() => mocks.inviteLinks),
    copyInviteLink: mocks.copyInviteLink,
    inviteUserByEmail: mocks.inviteUserByEmail,
    createInviteLink: mocks.createInviteLink,
    updateMemberRole: mocks.updateMemberRole,
    removeMember: mocks.removeMember,
    revokeInvite: mocks.revokeInvite,
  }),
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({
      path: `/libraries/${mocks.routeParamsId}/settings`,
      params: { id: mocks.routeParamsId },
      query: {},
      fullPath: `/libraries/${mocks.routeParamsId}/settings`,
    }),
    useRouter: () => ({
      push: mocks.routerPush,
      replace: vi.fn(),
      currentRoute: { value: { path: `/libraries/${mocks.routeParamsId}/settings`, query: {} } },
    }),
  };
});

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  ConfirmModal: { template: "<div data-stub='confirm-modal' />", props: ["open", "title", "message", "confirmLabel", "confirmClass", "confirmIcon", "pending"] },
  InviteLinkRow: { template: "<div data-stub='invite-link-row' />", props: ["invite", "revoking"] },
  LibraryMemberRow: { template: "<div data-stub='member-row' />", props: ["member", "roleDraft", "updatingRole", "removing", "roleOptions"] },
};

describe("library settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.library.isDefault = false;
    mocks.library.ownerId = "user-1";
    mocks.library.faceRecognitionEnabled = false;
    mocks.library.name = "Test Library";
    mocks.user.id = "user-1";
    mocks.libraryMembers = [];
    mocks.emailInvites = [];
    mocks.inviteLinks = [];
    mocks.apiFetch.mockResolvedValue({ totalCount: 0 });
  });

  function mountPage() {
    return mount(SettingsPage, {
      global: {
        stubs,
        provide: {
          refreshLibraries: mocks.refreshLibraries,
        },
      },
    });
  }

  it("renders library name section", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Library Name");
    const input = wrapper.find("input[placeholder='Library name']");
    expect(input.exists()).toBe(true);
  });

  it("renders facial recognition toggle section", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Facial Recognition");
  });

  it("renders delete library section", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Delete Library");
  });

  it("shows Library Members section for non-default library", async () => {
    mocks.library.isDefault = false;
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Library Members");
  });

  it("hides Library Members section for default library", async () => {
    mocks.library.isDefault = true;
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Library Members");
  });

  it("shows invite by email section", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Invite by Email");
    expect(wrapper.find("input[type='email']").exists()).toBe(true);
  });

  it("shows Create Link button when no invite links", async () => {
    mocks.inviteLinks = [];
    const wrapper = mountPage();
    await flushPromises();
    const linkBtns = wrapper.findAll("button").filter((b) => b.text().includes("Create Link"));
    expect(linkBtns.length).toBeGreaterThan(0);
  });

  it("shows Reprocess Faces button disabled when face rec is off", async () => {
    mocks.library.faceRecognitionEnabled = false;
    const wrapper = mountPage();
    await flushPromises();
    const btn = wrapper.findAll("button").find((b) => b.text().includes("Reprocess Faces"));
    expect(btn).toBeDefined();
    expect(btn!.attributes("disabled")).toBeDefined();
  });

  it("disables delete button when library has files", async () => {
    mocks.apiFetch.mockResolvedValue({ totalCount: 5 });
    const wrapper = mountPage();
    await flushPromises();
    const deleteBtn = wrapper.findAll("button").find((b) => b.text().includes("Delete"));
    expect(deleteBtn).toBeDefined();
    expect(deleteBtn!.attributes("disabled")).toBeDefined();
  });

  it("shows Video Thumbnails section for library owner", async () => {
    mocks.library.ownerId = "user-1";
    mocks.user.id = "user-1";
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Video Thumbnails");
  });

  it("hides Video Thumbnails section for non-owner", async () => {
    mocks.library.ownerId = "other-user";
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Video Thumbnails");
  });
});
