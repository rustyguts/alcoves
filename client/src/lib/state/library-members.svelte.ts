import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import type {
	LibraryInviteLink,
	LibraryMemberWithUser,
	LibraryUsersResponse
} from '$lib/types/api';

export interface CreateInviteLinkInput {
	maxUses?: number | null;
	expiresAt?: string | null;
}

/** Static option list for the invite-role select. Mirrors the Nuxt composable. */
export const inviteRoleOptions = [
	{ label: 'Viewer', value: 'viewer' as const },
	{ label: 'Admin', value: 'admin' as const }
];

/**
 * Members + invite-link management for a single library.
 *
 * `getLibraryId` / `getLibraryUsers` are getters so the store tracks the reactive
 * library id and users response from the consuming component (the Vue version took
 * `Ref<string>` / `Ref<LibraryUsersResponse>`). `refreshLibraryUsers` re-fetches the
 * users response after a mutation.
 *
 * State is exposed via getters so reactivity survives the function boundary. The
 * Vue `watch(libraryMembers, …)` that synced `memberRoleDrafts` becomes an explicit
 * `syncDrafts()` the component calls from its own `$effect` when members change —
 * no `$effect`/`watch` lives inside the store.
 */
export function createLibraryMembers(
	getLibraryId: () => string,
	getLibraryUsers: () => LibraryUsersResponse | null | undefined,
	refreshLibraryUsers: () => Promise<void>
) {
	let memberRoleDrafts = $state<Record<string, 'admin' | 'viewer'>>({});
	let createInviteLinkLoading = $state(false);
	let updatingMemberUserId = $state<string | null>(null);
	let removingMemberUserId = $state<string | null>(null);
	let revokingInviteId = $state<string | null>(null);

	const libraryMembers = $derived<LibraryMemberWithUser[]>(getLibraryUsers()?.members ?? []);
	const inviteLinks = $derived<LibraryInviteLink[]>(getLibraryUsers()?.inviteLinks ?? []);
	const memberAvatars = $derived(
		libraryMembers.map((member) => ({
			id: member.user.id,
			displayName: member.user.displayName,
			avatarUrl: member.user.avatarUrl
		}))
	);

	/**
	 * Reconcile `memberRoleDrafts` with the current members: seed a draft for each
	 * non-owner member and drop drafts for members that no longer exist. Replaces the
	 * Vue `watch(libraryMembers, …, { immediate: true })` — the component calls this
	 * from an `$effect` (and once on mount).
	 */
	function syncDrafts() {
		const members = libraryMembers;
		const next: Record<string, 'admin' | 'viewer'> = {};
		for (const member of members) {
			if (member.role === 'owner') continue;
			next[member.userId] = member.role;
		}
		// Preserve any in-flight edits the user made for still-valid members.

		const validIds = new Set(members.map((member) => member.userId));
		for (const userId of Object.keys(memberRoleDrafts)) {
			if (validIds.has(userId)) {
				next[userId] = memberRoleDrafts[userId];
			}
		}
		memberRoleDrafts = next;
	}

	async function copyInviteLink(url: string) {
		const absolute =
			typeof window !== 'undefined' && url.startsWith('/')
				? `${window.location.origin}${url}`
				: url;

		// Try the modern Clipboard API. Requires a secure context (HTTPS or
		// localhost); falls back to a textarea + execCommand on plain HTTP.
		const writeViaClipboardApi = async () => {
			if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
				throw new Error('clipboard api unavailable');
			}
			await navigator.clipboard.writeText(absolute);
		};

		const writeViaTextarea = () => {
			if (typeof document === 'undefined') return false;
			const ta = document.createElement('textarea');
			ta.value = absolute;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			ta.style.pointerEvents = 'none';
			document.body.appendChild(ta);
			ta.select();
			let ok = false;
			try {
				ok = document.execCommand('copy');
			} catch {
				// Copy command failed; `ok` stays false.
			}
			document.body.removeChild(ta);
			return ok;
		};

		try {
			await writeViaClipboardApi();
			toast.add({ title: 'Invite link copied' });
			return;
		} catch {
			// fall through to textarea fallback
		}

		if (writeViaTextarea()) {
			toast.add({ title: 'Invite link copied' });
			return;
		}

		// Last resort: surface the URL so user can copy manually.
		toast.add({
			title: 'Copy failed — link below',
			description: absolute,
			color: 'error'
		});
	}

	async function createInviteLink(input?: CreateInviteLinkInput) {
		createInviteLinkLoading = true;
		try {
			const invite = await api.members.createInviteLink(getLibraryId(), input);
			await refreshLibraryUsers();
			await copyInviteLink(invite.inviteUrl);
		} catch (err: unknown) {
			const msg =
				(err as { data?: { message?: string } })?.data?.message ?? 'Failed to create invite link';
			toast.add({ title: msg, color: 'error' });
		} finally {
			createInviteLinkLoading = false;
		}
	}

	async function updateMemberRole(member: LibraryMemberWithUser) {
		if (member.role === 'owner') return;

		const nextRole = memberRoleDrafts[member.userId];
		if (!nextRole || nextRole === member.role) return;

		updatingMemberUserId = member.userId;
		try {
			await api.members.updateRole(getLibraryId(), member.userId, { role: nextRole });
			await refreshLibraryUsers();
		} catch {
			memberRoleDrafts = { ...memberRoleDrafts, [member.userId]: member.role };
			toast.add({ title: 'Failed to update access', color: 'error' });
		} finally {
			updatingMemberUserId = null;
		}
	}

	async function removeMember(member: LibraryMemberWithUser) {
		if (member.role === 'owner') return;

		removingMemberUserId = member.userId;
		try {
			await api.members.remove(getLibraryId(), member.userId);
			await refreshLibraryUsers();
		} catch {
			toast.add({ title: 'Failed to remove member', color: 'error' });
		} finally {
			removingMemberUserId = null;
		}
	}

	async function revokeInvite(inviteId: string) {
		revokingInviteId = inviteId;
		try {
			await api.members.revokeInvite(getLibraryId(), inviteId);
			await refreshLibraryUsers();
		} catch {
			toast.add({ title: 'Failed to revoke invite', color: 'error' });
		} finally {
			revokingInviteId = null;
		}
	}

	return {
		get memberRoleDrafts() {
			return memberRoleDrafts;
		},
		set memberRoleDrafts(value: Record<string, 'admin' | 'viewer'>) {
			memberRoleDrafts = value;
		},
		get createInviteLinkLoading() {
			return createInviteLinkLoading;
		},
		get updatingMemberUserId() {
			return updatingMemberUserId;
		},
		get removingMemberUserId() {
			return removingMemberUserId;
		},
		get revokingInviteId() {
			return revokingInviteId;
		},
		inviteRoleOptions,
		get libraryMembers() {
			return libraryMembers;
		},
		get inviteLinks() {
			return inviteLinks;
		},
		get memberAvatars() {
			return memberAvatars;
		},
		syncDrafts,
		copyInviteLink,
		createInviteLink,
		updateMemberRole,
		removeMember,
		revokeInvite
	};
}
