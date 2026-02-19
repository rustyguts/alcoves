import type { Ref } from "vue";
import type {
  LibraryMemberWithUser,
  LibraryPendingInvite,
  LibraryUsersResponse,
} from "~~/shared/types/api";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";

type LibraryUsersRef = Ref<LibraryUsersResponse | null | undefined>;
type RefreshUsersFn = () => Promise<void>;

export function useLibraryMembers(
  libraryId: Ref<string>,
  libraryUsers: LibraryUsersRef,
  refreshLibraryUsers: RefreshUsersFn,
) {
  const toast = useToast();

  const memberRoleDrafts = reactive<Record<string, "admin" | "viewer">>({});
  const inviteEmail = ref("");
  const inviteEmailRole = ref<"admin" | "viewer">("viewer");
  const inviteByEmailLoading = ref(false);
  const createInviteLinkLoading = ref(false);
  const updatingMemberUserId = ref<string | null>(null);
  const removingMemberUserId = ref<string | null>(null);
  const revokingInviteId = ref<string | null>(null);

  const inviteRoleOptions = [
    { label: "Viewer", value: "viewer" as const },
    { label: "Admin", value: "admin" as const },
  ];

  const libraryMembers = computed<LibraryMemberWithUser[]>(() => libraryUsers.value?.members ?? []);
  const libraryPendingInvites = computed<LibraryPendingInvite[]>(
    () => libraryUsers.value?.pendingInvites ?? [],
  );
  const emailInvites = computed(() =>
    libraryPendingInvites.value.filter((invite) => Boolean(invite.invitedEmail)),
  );
  const inviteLinks = computed(() =>
    libraryPendingInvites.value.filter((invite) => !invite.invitedEmail),
  );
  const memberAvatars = computed(() =>
    libraryMembers.value.map((member) => ({
      id: member.user.id,
      displayName: member.user.displayName,
      avatarUrl: member.user.avatarUrl,
    })),
  );

  watch(
    libraryMembers,
    (members) => {
      for (const member of members) {
        if (member.role === "owner") continue;
        memberRoleDrafts[member.userId] = member.role;
      }

      const validIds = new Set(members.map((member) => member.userId));
      Object.keys(memberRoleDrafts).forEach((userId) => {
        if (!validIds.has(userId)) {
          delete memberRoleDrafts[userId];
        }
      });
    },
    { immediate: true },
  );

  async function copyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.add({ title: "Invite link copied" });
    } catch {
      toast.add({ title: "Unable to copy invite link", color: "error" });
    }
  }

  async function inviteUserByEmail() {
    const email = inviteEmail.value.trim();
    if (!email) return;

    inviteByEmailLoading.value = true;
    try {
      const result = await api.members.inviteByEmail(libraryId.value, { email, role: inviteEmailRole.value });

      if (result.action === "already_member") {
        toast.add({ title: "User already has access" });
      } else if (result.action === "added") {
        toast.add({ title: "User added to library" });
      } else {
        toast.add({ title: "Invite created" });
        if (result.invite?.inviteUrl) {
          await copyInviteLink(result.invite.inviteUrl);
        }
      }

      inviteEmail.value = "";
      await refreshLibraryUsers();
    } catch (err: unknown) {
      toast.add({
        title: (err as { data?: { message?: string } })?.data?.message ?? "Failed to invite user",
        color: "error",
      });
    } finally {
      inviteByEmailLoading.value = false;
    }
  }

  async function createInviteLink() {
    createInviteLinkLoading.value = true;
    try {
      const invite = await api.members.createInviteLink(libraryId.value);

      await refreshLibraryUsers();
      await copyInviteLink(invite.inviteUrl);
    } catch {
      toast.add({ title: "Failed to create invite link", color: "error" });
    } finally {
      createInviteLinkLoading.value = false;
    }
  }

  async function updateMemberRole(member: LibraryMemberWithUser) {
    if (member.role === "owner") return;

    const nextRole = memberRoleDrafts[member.userId];
    if (!nextRole || nextRole === member.role) return;

    updatingMemberUserId.value = member.userId;
    try {
      await api.members.updateRole(libraryId.value, member.userId, { role: nextRole });
      await refreshLibraryUsers();
    } catch {
      memberRoleDrafts[member.userId] = member.role;
      toast.add({ title: "Failed to update access", color: "error" });
    } finally {
      updatingMemberUserId.value = null;
    }
  }

  async function removeMember(member: LibraryMemberWithUser) {
    if (member.role === "owner") return;

    removingMemberUserId.value = member.userId;
    try {
      await api.members.remove(libraryId.value, member.userId);
      await refreshLibraryUsers();
    } catch {
      toast.add({ title: "Failed to remove member", color: "error" });
    } finally {
      removingMemberUserId.value = null;
    }
  }

  async function revokeInvite(inviteId: string) {
    revokingInviteId.value = inviteId;
    try {
      await api.members.revokeInvite(libraryId.value, inviteId);
      await refreshLibraryUsers();
    } catch {
      toast.add({ title: "Failed to revoke invite", color: "error" });
    } finally {
      revokingInviteId.value = null;
    }
  }

  return {
    memberRoleDrafts,
    inviteEmail,
    inviteEmailRole,
    inviteByEmailLoading,
    createInviteLinkLoading,
    updatingMemberUserId,
    removingMemberUserId,
    revokingInviteId,
    inviteRoleOptions,
    libraryMembers,
    libraryPendingInvites,
    emailInvites,
    inviteLinks,
    memberAvatars,
    copyInviteLink,
    inviteUserByEmail,
    createInviteLink,
    updateMemberRole,
    removeMember,
    revokeInvite,
  };
}
