import type { Ref } from "vue";
import type {
  LibraryMemberWithUser,
  LibraryInviteLink,
  LibraryUsersResponse,
} from "~~/shared/types/api";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";

type LibraryUsersRef = Ref<LibraryUsersResponse | null | undefined>;
type RefreshUsersFn = () => Promise<void>;

export interface CreateInviteLinkInput {
  maxUses?: number | null;
  expiresAt?: string | null;
}

export function useLibraryMembers(
  libraryId: Ref<string>,
  libraryUsers: LibraryUsersRef,
  refreshLibraryUsers: RefreshUsersFn,
) {
  const toast = useToast();

  const memberRoleDrafts = reactive<Record<string, "admin" | "viewer">>({});
  const createInviteLinkLoading = ref(false);
  const updatingMemberUserId = ref<string | null>(null);
  const removingMemberUserId = ref<string | null>(null);
  const revokingInviteId = ref<string | null>(null);

  const inviteRoleOptions = [
    { label: "Viewer", value: "viewer" as const },
    { label: "Admin", value: "admin" as const },
  ];

  const libraryMembers = computed<LibraryMemberWithUser[]>(() => libraryUsers.value?.members ?? []);
  const inviteLinks = computed<LibraryInviteLink[]>(() => libraryUsers.value?.inviteLinks ?? []);
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
    const absolute =
      typeof window !== "undefined" && url.startsWith("/")
        ? `${window.location.origin}${url}`
        : url;

    // Try the modern Clipboard API. Requires a secure context (HTTPS or
    // localhost); falls back to a textarea + execCommand on plain HTTP.
    const writeViaClipboardApi = async () => {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard api unavailable");
      }
      await navigator.clipboard.writeText(absolute);
    };

    const writeViaTextarea = () => {
      if (typeof document === "undefined") return false;
      const ta = document.createElement("textarea");
      ta.value = absolute;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    };

    try {
      await writeViaClipboardApi();
      toast.add({ title: "Invite link copied" });
      return;
    } catch {
      // fall through to textarea fallback
    }

    if (writeViaTextarea()) {
      toast.add({ title: "Invite link copied" });
      return;
    }

    // Last resort: surface the URL so user can copy manually.
    toast.add({
      title: "Copy failed — link below",
      description: absolute,
      color: "error",
    });
  }

  async function createInviteLink(input?: CreateInviteLinkInput) {
    createInviteLinkLoading.value = true;
    try {
      const invite = await api.members.createInviteLink(libraryId.value, input);
      await refreshLibraryUsers();
      await copyInviteLink(invite.inviteUrl);
    } catch (err: unknown) {
      const msg =
        (err as { data?: { message?: string } })?.data?.message ?? "Failed to create invite link";
      toast.add({ title: msg, color: "error" });
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
    createInviteLinkLoading,
    updatingMemberUserId,
    removingMemberUserId,
    revokingInviteId,
    inviteRoleOptions,
    libraryMembers,
    inviteLinks,
    memberAvatars,
    copyInviteLink,
    createInviteLink,
    updateMemberRole,
    removeMember,
    revokeInvite,
  };
}
