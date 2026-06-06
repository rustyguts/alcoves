import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type {
	LibraryInviteLink,
	LibraryMemberWithUser,
	LibraryUsersResponse
} from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	members: {
		list: vi.fn(),
		createInviteLink: vi.fn(),
		updateRole: vi.fn(),
		remove: vi.fn(),
		revokeInvite: vi.fn()
	}
}));

const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { createLibraryMembers, inviteRoleOptions } from './library-members.svelte';

function makeMember(
	overrides: Partial<LibraryMemberWithUser> & { userId: string }
): LibraryMemberWithUser {
	return {
		id: `m-${overrides.userId}`,
		role: 'viewer',
		isOwner: false,
		createdAt: '2025-01-01T00:00:00Z',
		user: {
			id: overrides.userId,
			email: `${overrides.userId}@example.com`,
			displayName: overrides.userId,
			avatarUrl: null
		},
		...overrides
	};
}

function makeInvite(overrides: Partial<LibraryInviteLink> & { id: string }): LibraryInviteLink {
	return {
		token: `token-${overrides.id}`,
		maxUses: null,
		useCount: 0,
		expiresAt: null,
		createdAt: '2025-01-01T00:00:00Z',
		inviteUrl: `https://example.com/invites/token-${overrides.id}`,
		invitedBy: { id: 'u-owner', displayName: 'Owner', avatarUrl: null },
		uses: [],
		...overrides
	};
}

function makeUsersResponse(
	members: LibraryMemberWithUser[] = [],
	inviteLinks: LibraryInviteLink[] = []
): LibraryUsersResponse {
	return {
		libraryId: 'lib-1',
		canManageUsers: true,
		members,
		inviteLinks
	};
}

describe('createLibraryMembers', () => {
	let refreshLibraryUsers: Mock<() => Promise<void>>;

	beforeEach(() => {
		vi.clearAllMocks();
		refreshLibraryUsers = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function create(usersResponse: LibraryUsersResponse | null = null, libraryId = 'lib-1') {
		return createLibraryMembers(
			() => libraryId,
			() => usersResponse,
			refreshLibraryUsers
		);
	}

	function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
		vi.stubGlobal('navigator', { clipboard: { writeText } });
	}

	it('exposes static inviteRoleOptions (viewer + admin)', () => {
		expect(inviteRoleOptions).toEqual([
			{ label: 'Viewer', value: 'viewer' },
			{ label: 'Admin', value: 'admin' }
		]);
		const store = create();
		expect(store.inviteRoleOptions).toBe(inviteRoleOptions);
	});

	it('starts with empty loading/in-flight state', () => {
		const store = create();
		expect(store.createInviteLinkLoading).toBe(false);
		expect(store.updatingMemberUserId).toBeNull();
		expect(store.removingMemberUserId).toBeNull();
		expect(store.revokingInviteId).toBeNull();
		expect(store.memberRoleDrafts).toEqual({});
	});

	it('computes libraryMembers from users response', () => {
		const member = makeMember({ userId: 'u1' });
		const store = create(makeUsersResponse([member]));

		expect(store.libraryMembers).toHaveLength(1);
		expect(store.libraryMembers[0]!.userId).toBe('u1');
	});

	it('computes empty libraryMembers when null', () => {
		const store = create(null);
		expect(store.libraryMembers).toEqual([]);
	});

	it('exposes inviteLinks from users response', () => {
		const link1 = makeInvite({ id: 'i1' });
		const link2 = makeInvite({ id: 'i2' });
		const store = create(makeUsersResponse([], [link1, link2]));

		expect(store.inviteLinks).toHaveLength(2);
		expect(store.inviteLinks[0]!.id).toBe('i1');
	});

	it('computes empty inviteLinks when null', () => {
		const store = create(null);
		expect(store.inviteLinks).toEqual([]);
	});

	it('computes memberAvatars', () => {
		const member = makeMember({
			userId: 'u1',
			user: {
				id: 'u1',
				email: 'u1@example.com',
				displayName: 'User One',
				avatarUrl: 'https://example.com/avatar.png'
			}
		});
		const store = create(makeUsersResponse([member]));

		expect(store.memberAvatars).toEqual([
			{ id: 'u1', displayName: 'User One', avatarUrl: 'https://example.com/avatar.png' }
		]);
	});

	describe('syncDrafts', () => {
		it('syncs memberRoleDrafts from members, skipping owners', () => {
			const owner = makeMember({ userId: 'u-owner', role: 'owner' });
			const admin = makeMember({ userId: 'u-admin', role: 'admin' });
			const viewer = makeMember({ userId: 'u-viewer', role: 'viewer' });
			const store = create(makeUsersResponse([owner, admin, viewer]));

			store.syncDrafts();

			expect(store.memberRoleDrafts['u-owner']).toBeUndefined();
			expect(store.memberRoleDrafts['u-admin']).toBe('admin');
			expect(store.memberRoleDrafts['u-viewer']).toBe('viewer');
		});

		it('drops drafts for members that no longer exist', () => {
			const a = makeMember({ userId: 'a', role: 'viewer' });
			const b = makeMember({ userId: 'b', role: 'admin' });
			let users = makeUsersResponse([a, b]);
			const store = createLibraryMembers(
				() => 'lib-1',
				() => users,
				refreshLibraryUsers
			);

			store.syncDrafts();
			expect(Object.keys(store.memberRoleDrafts).sort()).toEqual(['a', 'b']);

			// b leaves the library; re-sync should drop its draft.
			users = makeUsersResponse([a]);
			store.syncDrafts();
			expect(store.memberRoleDrafts).toEqual({ a: 'viewer' });
		});

		it('preserves an in-flight edit for a still-valid member', () => {
			const member = makeMember({ userId: 'u1', role: 'viewer' });
			const store = create(makeUsersResponse([member]));

			store.syncDrafts();
			store.memberRoleDrafts = { ...store.memberRoleDrafts, u1: 'admin' };
			store.syncDrafts();

			expect(store.memberRoleDrafts['u1']).toBe('admin');
		});
	});

	describe('copyInviteLink', () => {
		it('copies to clipboard', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);

			const store = create();
			await store.copyInviteLink('https://example.com/invite');

			expect(writeText).toHaveBeenCalledWith('https://example.com/invite');
			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Invite link copied' });
		});

		it('absolutizes relative paths using window.location.origin', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);
			vi.stubGlobal('window', { location: { origin: 'https://app.test' } });

			const store = create();
			await store.copyInviteLink('/invites/abc');

			expect(writeText).toHaveBeenCalledWith('https://app.test/invites/abc');
		});

		it('leaves relative paths untouched when window is undefined', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);
			// no window stub → typeof window === 'undefined' in node

			const store = create();
			await store.copyInviteLink('/invites/abc');

			expect(writeText).toHaveBeenCalledWith('/invites/abc');
		});

		it('falls back to textarea when clipboard API rejects', async () => {
			const writeText = vi.fn().mockRejectedValue(new Error('denied'));
			stubClipboard(writeText);

			const ta = {
				value: '',
				setAttribute: vi.fn(),
				style: {} as Record<string, string>,
				select: vi.fn()
			};
			const execCommand = vi.fn().mockReturnValue(true);
			vi.stubGlobal('document', {
				createElement: vi.fn().mockReturnValue(ta),
				body: { appendChild: vi.fn(), removeChild: vi.fn() },
				execCommand
			});

			const store = create();
			await store.copyInviteLink('https://example.com/invite');

			expect(ta.value).toBe('https://example.com/invite');
			expect(execCommand).toHaveBeenCalledWith('copy');
			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Invite link copied' });
		});

		it('treats an execCommand throw as a failed textarea copy', async () => {
			const writeText = vi.fn().mockRejectedValue(new Error('denied'));
			stubClipboard(writeText);

			const ta = {
				value: '',
				setAttribute: vi.fn(),
				style: {} as Record<string, string>,
				select: vi.fn()
			};
			const execCommand = vi.fn().mockImplementation(() => {
				throw new Error('boom');
			});
			vi.stubGlobal('document', {
				createElement: vi.fn().mockReturnValue(ta),
				body: { appendChild: vi.fn(), removeChild: vi.fn() },
				execCommand
			});

			const store = create();
			await store.copyInviteLink('https://example.com/invite');

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Copy failed — link below',
				description: 'https://example.com/invite',
				color: 'error'
			});
		});

		it('surfaces the URL when clipboard rejects and document is undefined', async () => {
			const writeText = vi.fn().mockRejectedValue(new Error('denied'));
			stubClipboard(writeText);
			// no document stub → typeof document === 'undefined' → textarea returns false

			const store = create();
			await store.copyInviteLink('https://example.com/invite');

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Copy failed — link below',
				description: 'https://example.com/invite',
				color: 'error'
			});
		});

		it('surfaces the URL when both clipboard and textarea fail', async () => {
			const writeText = vi.fn().mockRejectedValue(new Error('denied'));
			stubClipboard(writeText);

			const ta = {
				value: '',
				setAttribute: vi.fn(),
				style: {} as Record<string, string>,
				select: vi.fn()
			};
			const execCommand = vi.fn().mockReturnValue(false);
			vi.stubGlobal('document', {
				createElement: vi.fn().mockReturnValue(ta),
				body: { appendChild: vi.fn(), removeChild: vi.fn() },
				execCommand
			});

			const store = create();
			await store.copyInviteLink('https://example.com/invite');

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Copy failed — link below',
				description: 'https://example.com/invite',
				color: 'error'
			});
		});

		it('throws clipboard-unavailable path when navigator is undefined (falls to textarea)', async () => {
			// no navigator stub → typeof navigator === 'undefined'
			const ta = {
				value: '',
				setAttribute: vi.fn(),
				style: {} as Record<string, string>,
				select: vi.fn()
			};
			const execCommand = vi.fn().mockReturnValue(true);
			vi.stubGlobal('document', {
				createElement: vi.fn().mockReturnValue(ta),
				body: { appendChild: vi.fn(), removeChild: vi.fn() },
				execCommand
			});

			const store = create();
			await store.copyInviteLink('https://example.com/invite');

			expect(execCommand).toHaveBeenCalledWith('copy');
			expect(toastMock.add).toHaveBeenCalledWith({ title: 'Invite link copied' });
		});
	});

	describe('createInviteLink', () => {
		it('posts and copies the returned URL, toggling loading', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);
			apiMock.members.createInviteLink.mockResolvedValueOnce({
				inviteUrl: 'https://example.com/link'
			});

			const store = create();
			const promise = store.createInviteLink();
			expect(store.createInviteLinkLoading).toBe(true);
			await promise;

			expect(apiMock.members.createInviteLink).toHaveBeenCalledWith('lib-1', undefined);
			expect(refreshLibraryUsers).toHaveBeenCalled();
			expect(writeText).toHaveBeenCalledWith('https://example.com/link');
			expect(store.createInviteLinkLoading).toBe(false);
		});

		it('absolutizes a relative inviteUrl before copying', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);
			vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
			apiMock.members.createInviteLink.mockResolvedValueOnce({ inviteUrl: '/invites/abc' });

			const store = create();
			await store.createInviteLink();

			expect(writeText).toHaveBeenCalledWith('https://app.test/invites/abc');
		});

		it('forwards maxUses and expiresAt', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);
			apiMock.members.createInviteLink.mockResolvedValueOnce({
				inviteUrl: 'https://example.com/link'
			});

			const store = create();
			await store.createInviteLink({ maxUses: 5, expiresAt: '2030-01-01T00:00:00Z' });

			expect(apiMock.members.createInviteLink).toHaveBeenCalledWith('lib-1', {
				maxUses: 5,
				expiresAt: '2030-01-01T00:00:00Z'
			});
		});

		it('shows a default toast on error and clears loading', async () => {
			apiMock.members.createInviteLink.mockRejectedValueOnce(new Error('fail'));

			const store = create();
			await store.createInviteLink();

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Failed to create invite link',
				color: 'error'
			});
			expect(store.createInviteLinkLoading).toBe(false);
		});

		it('surfaces a server-provided error message', async () => {
			apiMock.members.createInviteLink.mockRejectedValueOnce({ data: { message: 'too many' } });

			const store = create();
			await store.createInviteLink();

			expect(toastMock.add).toHaveBeenCalledWith({ title: 'too many', color: 'error' });
		});
	});

	describe('updateMemberRole', () => {
		it('patches role and refreshes, toggling updatingMemberUserId', async () => {
			apiMock.members.updateRole.mockResolvedValueOnce(undefined);

			const member = makeMember({ userId: 'u1', role: 'viewer' });
			const store = create(makeUsersResponse([member]));

			store.syncDrafts();
			store.memberRoleDrafts = { ...store.memberRoleDrafts, u1: 'admin' };

			const promise = store.updateMemberRole(member);
			expect(store.updatingMemberUserId).toBe('u1');
			await promise;

			expect(apiMock.members.updateRole).toHaveBeenCalledWith('lib-1', 'u1', { role: 'admin' });
			expect(refreshLibraryUsers).toHaveBeenCalled();
			expect(store.updatingMemberUserId).toBeNull();
		});

		it('does nothing for owners', async () => {
			const member = makeMember({ userId: 'u1', role: 'owner' });
			const store = create(makeUsersResponse([member]));

			await store.updateMemberRole(member);
			expect(apiMock.members.updateRole).not.toHaveBeenCalled();
		});

		it('does nothing when there is no draft', async () => {
			const member = makeMember({ userId: 'u1', role: 'viewer' });
			const store = create(makeUsersResponse([member]));
			// no syncDrafts → memberRoleDrafts is empty

			await store.updateMemberRole(member);
			expect(apiMock.members.updateRole).not.toHaveBeenCalled();
		});

		it('does nothing when role unchanged', async () => {
			const member = makeMember({ userId: 'u1', role: 'viewer' });
			const store = create(makeUsersResponse([member]));

			store.syncDrafts();
			store.memberRoleDrafts = { ...store.memberRoleDrafts, u1: 'viewer' };

			await store.updateMemberRole(member);
			expect(apiMock.members.updateRole).not.toHaveBeenCalled();
		});

		it('reverts the draft and toasts on error', async () => {
			apiMock.members.updateRole.mockRejectedValueOnce(new Error('fail'));

			const member = makeMember({ userId: 'u1', role: 'viewer' });
			const store = create(makeUsersResponse([member]));

			store.syncDrafts();
			store.memberRoleDrafts = { ...store.memberRoleDrafts, u1: 'admin' };

			await store.updateMemberRole(member);

			expect(store.memberRoleDrafts['u1']).toBe('viewer');
			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Failed to update access',
				color: 'error'
			});
			expect(store.updatingMemberUserId).toBeNull();
		});
	});

	describe('removeMember', () => {
		it('calls DELETE and refreshes, toggling removingMemberUserId', async () => {
			apiMock.members.remove.mockResolvedValueOnce(undefined);

			const member = makeMember({ userId: 'u1', role: 'viewer' });
			const store = create(makeUsersResponse([member]));

			const promise = store.removeMember(member);
			expect(store.removingMemberUserId).toBe('u1');
			await promise;

			expect(apiMock.members.remove).toHaveBeenCalledWith('lib-1', 'u1');
			expect(refreshLibraryUsers).toHaveBeenCalled();
			expect(store.removingMemberUserId).toBeNull();
		});

		it('does nothing for owners', async () => {
			const member = makeMember({ userId: 'u1', role: 'owner' });
			const store = create(makeUsersResponse([member]));

			await store.removeMember(member);
			expect(apiMock.members.remove).not.toHaveBeenCalled();
		});

		it('shows a toast on error and clears in-flight id', async () => {
			apiMock.members.remove.mockRejectedValueOnce(new Error('fail'));

			const member = makeMember({ userId: 'u1', role: 'viewer' });
			const store = create(makeUsersResponse([member]));

			await store.removeMember(member);
			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Failed to remove member',
				color: 'error'
			});
			expect(store.removingMemberUserId).toBeNull();
		});
	});

	describe('revokeInvite', () => {
		it('calls DELETE and refreshes, toggling revokingInviteId', async () => {
			apiMock.members.revokeInvite.mockResolvedValueOnce(undefined);

			const store = create();
			const promise = store.revokeInvite('inv-1');
			expect(store.revokingInviteId).toBe('inv-1');
			await promise;

			expect(apiMock.members.revokeInvite).toHaveBeenCalledWith('lib-1', 'inv-1');
			expect(refreshLibraryUsers).toHaveBeenCalled();
			expect(store.revokingInviteId).toBeNull();
		});

		it('shows a toast on error and clears in-flight id', async () => {
			apiMock.members.revokeInvite.mockRejectedValueOnce(new Error('fail'));

			const store = create();
			await store.revokeInvite('inv-1');

			expect(toastMock.add).toHaveBeenCalledWith({
				title: 'Failed to revoke invite',
				color: 'error'
			});
			expect(store.revokingInviteId).toBeNull();
		});
	});

	it('reads the libraryId getter lazily for mutations', async () => {
		apiMock.members.revokeInvite.mockResolvedValue(undefined);
		let libraryId = 'lib-a';
		const store = createLibraryMembers(
			() => libraryId,
			() => null,
			refreshLibraryUsers
		);

		await store.revokeInvite('inv-1');
		expect(apiMock.members.revokeInvite).toHaveBeenLastCalledWith('lib-a', 'inv-1');

		libraryId = 'lib-b';
		await store.revokeInvite('inv-2');
		expect(apiMock.members.revokeInvite).toHaveBeenLastCalledWith('lib-b', 'inv-2');
	});
});
