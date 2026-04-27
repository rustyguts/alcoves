vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

import { useLibraryMembers } from "~/composables/useLibraryMembers";
import { apiFetch } from "~/utils/api-fetch";
import type {
  LibraryMemberWithUser,
  LibraryPendingInvite,
  LibraryUsersResponse,
} from "~~/shared/types/api";

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

function makeMember(
  overrides: Partial<LibraryMemberWithUser> & { userId: string },
): LibraryMemberWithUser {
  return {
    id: `m-${overrides.userId}`,
    role: "viewer",
    isOwner: false,
    createdAt: "2025-01-01T00:00:00Z",
    user: {
      id: overrides.userId,
      email: `${overrides.userId}@example.com`,
      displayName: overrides.userId,
      avatarUrl: null,
    },
    ...overrides,
  };
}

function makeInvite(
  overrides: Partial<LibraryPendingInvite> & { id: string },
): LibraryPendingInvite {
  return {
    invitedEmail: null,
    role: "viewer",
    useCount: 0,
    createdAt: "2025-01-01T00:00:00Z",
    inviteUrl: `https://example.com/invites/token-${overrides.id}`,
    invitedBy: { id: "u-owner", displayName: "Owner", avatarUrl: null },
    ...overrides,
  };
}

function makeUsersResponse(
  members: LibraryMemberWithUser[] = [],
  pendingInvites: LibraryPendingInvite[] = [],
): LibraryUsersResponse {
  return {
    libraryId: "lib-1",
    canManageUsers: true,
    members,
    pendingInvites,
  };
}

describe("useLibraryMembers", () => {
  let refreshLibraryUsers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockApiFetch.mockReset();
    mocks.toast.add.mockReset();
    refreshLibraryUsers = vi.fn();
  });

  function create(usersResponse: LibraryUsersResponse | null = null) {
    return useLibraryMembers(ref("lib-1"), ref(usersResponse), refreshLibraryUsers);
  }

  it("computes libraryMembers from users response", () => {
    const member = makeMember({ userId: "u1" });
    const { libraryMembers } = create(makeUsersResponse([member]));

    expect(libraryMembers.value).toHaveLength(1);
    expect(libraryMembers.value[0]!.userId).toBe("u1");
  });

  it("computes empty libraryMembers when null", () => {
    const { libraryMembers } = create(null);
    expect(libraryMembers.value).toEqual([]);
  });

  it("splits pending invites into email invites and invite links", () => {
    const emailInvite = makeInvite({ id: "i1", invitedEmail: "user@example.com" });
    const linkInvite = makeInvite({ id: "i2", invitedEmail: null });
    const response = makeUsersResponse([], [emailInvite, linkInvite]);
    const { emailInvites, inviteLinks } = create(response);

    expect(emailInvites.value).toHaveLength(1);
    expect(emailInvites.value[0]!.id).toBe("i1");
    expect(inviteLinks.value).toHaveLength(1);
    expect(inviteLinks.value[0]!.id).toBe("i2");
  });

  it("computes memberAvatars", () => {
    const member = makeMember({
      userId: "u1",
      user: {
        id: "u1",
        email: "u1@example.com",
        displayName: "User One",
        avatarUrl: "https://example.com/avatar.png",
      },
    });
    const { memberAvatars } = create(makeUsersResponse([member]));

    expect(memberAvatars.value).toEqual([
      { id: "u1", displayName: "User One", avatarUrl: "https://example.com/avatar.png" },
    ]);
  });

  it("syncs memberRoleDrafts from members, skipping owners", async () => {
    const owner = makeMember({ userId: "u-owner", role: "owner" });
    const admin = makeMember({ userId: "u-admin", role: "admin" });
    const viewer = makeMember({ userId: "u-viewer", role: "viewer" });
    const { memberRoleDrafts } = create(makeUsersResponse([owner, admin, viewer]));

    await nextTick();

    expect(memberRoleDrafts["u-owner"]).toBeUndefined();
    expect(memberRoleDrafts["u-admin"]).toBe("admin");
    expect(memberRoleDrafts["u-viewer"]).toBe("viewer");
  });

  it("copyInviteLink copies to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { copyInviteLink } = create();
    await copyInviteLink("https://example.com/invite");

    expect(writeText).toHaveBeenCalledWith("https://example.com/invite");
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Invite link copied" });
  });

  it("copyInviteLink shows error on failure", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    const { copyInviteLink } = create();
    await copyInviteLink("https://example.com/invite");

    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Unable to copy invite link",
      color: "error",
    });
  });

  it("inviteUserByEmail posts and refreshes on success", async () => {
    mockApiFetch.mockResolvedValueOnce({ action: "added" });

    const { inviteUserByEmail, inviteEmail, inviteEmailRole } = create();
    inviteEmail.value = "user@example.com";
    inviteEmailRole.value = "admin";

    await inviteUserByEmail();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/users/invite-email", {
      method: "POST",
      body: { email: "user@example.com", role: "admin" },
    });
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "User added to library" });
    expect(inviteEmail.value).toBe("");
    expect(refreshLibraryUsers).toHaveBeenCalled();
  });

  it("inviteUserByEmail handles already_member", async () => {
    mockApiFetch.mockResolvedValueOnce({ action: "already_member" });

    const { inviteUserByEmail, inviteEmail } = create();
    inviteEmail.value = "user@example.com";

    await inviteUserByEmail();
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "User already has access" });
  });

  it("inviteUserByEmail handles invited with invite URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    mockApiFetch.mockResolvedValueOnce({
      action: "invited",
      invite: { inviteUrl: "https://example.com/invite" },
    });

    const { inviteUserByEmail, inviteEmail } = create();
    inviteEmail.value = "user@example.com";

    await inviteUserByEmail();
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Invite created" });
  });

  it("inviteUserByEmail does nothing with empty email", async () => {
    const { inviteUserByEmail, inviteEmail } = create();
    inviteEmail.value = "   ";

    await inviteUserByEmail();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("inviteUserByEmail shows error on failure", async () => {
    mockApiFetch.mockRejectedValueOnce({ data: { message: "Bad request" } });

    const { inviteUserByEmail, inviteEmail } = create();
    inviteEmail.value = "user@example.com";

    await inviteUserByEmail();
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Bad request", color: "error" });
  });

  it("createInviteLink posts and copies URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    mockApiFetch.mockResolvedValueOnce({ inviteUrl: "https://example.com/link" });

    const { createInviteLink } = create();
    await createInviteLink();

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/users/invite-link", {
      method: "POST",
    });
    expect(refreshLibraryUsers).toHaveBeenCalled();
  });

  it("createInviteLink shows toast on error", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("fail"));

    const { createInviteLink } = create();
    await createInviteLink();

    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Failed to create invite link",
      color: "error",
    });
  });

  it("updateMemberRole patches role and refreshes", async () => {
    mockApiFetch.mockResolvedValueOnce({});

    const member = makeMember({ userId: "u1", role: "viewer" });
    const { updateMemberRole, memberRoleDrafts } = create(makeUsersResponse([member]));

    await nextTick();
    memberRoleDrafts["u1"] = "admin";

    await updateMemberRole(member);

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/users/u1", {
      method: "PATCH",
      body: { role: "admin" },
    });
    expect(refreshLibraryUsers).toHaveBeenCalled();
  });

  it("updateMemberRole does nothing for owners", async () => {
    const member = makeMember({ userId: "u1", role: "owner" });
    const { updateMemberRole } = create(makeUsersResponse([member]));

    await updateMemberRole(member);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("updateMemberRole does nothing when role unchanged", async () => {
    const member = makeMember({ userId: "u1", role: "viewer" });
    const { updateMemberRole, memberRoleDrafts } = create(makeUsersResponse([member]));

    await nextTick();
    // Draft is same as current
    memberRoleDrafts["u1"] = "viewer";

    await updateMemberRole(member);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("updateMemberRole reverts draft on error", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("fail"));

    const member = makeMember({ userId: "u1", role: "viewer" });
    const { updateMemberRole, memberRoleDrafts } = create(makeUsersResponse([member]));

    await nextTick();
    memberRoleDrafts["u1"] = "admin";

    await updateMemberRole(member);

    expect(memberRoleDrafts["u1"]).toBe("viewer");
    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Failed to update access",
      color: "error",
    });
  });

  it("removeMember calls DELETE and refreshes", async () => {
    mockApiFetch.mockResolvedValueOnce({});

    const member = makeMember({ userId: "u1", role: "viewer" });
    const { removeMember } = create(makeUsersResponse([member]));

    await removeMember(member);

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/users/u1", {
      method: "DELETE",
    });
    expect(refreshLibraryUsers).toHaveBeenCalled();
  });

  it("removeMember does nothing for owners", async () => {
    const member = makeMember({ userId: "u1", role: "owner" });
    const { removeMember } = create(makeUsersResponse([member]));

    await removeMember(member);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("removeMember shows toast on error", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("fail"));

    const member = makeMember({ userId: "u1", role: "viewer" });
    const { removeMember } = create(makeUsersResponse([member]));

    await removeMember(member);
    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Failed to remove member",
      color: "error",
    });
  });

  it("revokeInvite calls DELETE and refreshes", async () => {
    mockApiFetch.mockResolvedValueOnce({});

    const { revokeInvite } = create();
    await revokeInvite("inv-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/users/invites/inv-1", {
      method: "DELETE",
    });
    expect(refreshLibraryUsers).toHaveBeenCalled();
  });

  it("revokeInvite shows toast on error", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("fail"));

    const { revokeInvite } = create();
    await revokeInvite("inv-1");

    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Failed to revoke invite",
      color: "error",
    });
  });
});
