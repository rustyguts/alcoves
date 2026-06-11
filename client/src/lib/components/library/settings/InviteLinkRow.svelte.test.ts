import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InviteLinkRow from './InviteLinkRow.svelte';
import type { LibraryInviteLink } from '$lib/types/api';

function createInvite(overrides: Partial<LibraryInviteLink> = {}): LibraryInviteLink {
	return {
		id: 'inv-1',
		token: 'abc123',
		maxUses: null,
		useCount: 3,
		expiresAt: null,
		createdAt: '2024-01-01T00:00:00Z',
		inviteUrl: 'https://app.example.com/invites/abc123',
		invitedBy: { id: 'u-1', displayName: 'Owner', avatarUrl: null },
		uses: [],
		...overrides
	};
}

describe('InviteLinkRow', () => {
	it('renders the invite URL', async () => {
		const screen = render(InviteLinkRow, { props: { invite: createInvite(), revoking: false } });
		await expect
			.element(screen.getByText('https://app.example.com/invites/abc123'))
			.toBeInTheDocument();
	});

	it('renders a plural use label', async () => {
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite({ useCount: 3 }), revoking: false }
		});
		await expect.element(screen.getByText('3 uses')).toBeInTheDocument();
	});

	it('renders a singular use label', async () => {
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite({ useCount: 1 }), revoking: false }
		});
		await expect.element(screen.getByText('1 use')).toBeInTheDocument();
	});

	it('renders a capped count when maxUses is set', async () => {
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite({ useCount: 2, maxUses: 5 }), revoking: false }
		});
		await expect.element(screen.getByText('2 / 5 uses')).toBeInTheDocument();
	});

	it('flags exhausted invites', async () => {
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite({ useCount: 5, maxUses: 5 }), revoking: false }
		});
		await expect.element(screen.getByText('Exhausted')).toBeInTheDocument();
	});

	it('renders "Never expires" when expiresAt is null', async () => {
		const screen = render(InviteLinkRow, { props: { invite: createInvite(), revoking: false } });
		await expect.element(screen.getByText('Never expires')).toBeInTheDocument();
	});

	it('shows the Expires copy when expiresAt is set', async () => {
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite({ expiresAt: '2099-12-31T00:00:00Z' }), revoking: false }
		});
		expect(screen.container.textContent).toContain('Expires');
	});

	it('flags the Expired badge when expiresAt is in the past', async () => {
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite({ expiresAt: '2000-01-01T00:00:00Z' }), revoking: false }
		});
		await expect.element(screen.getByText('Expired')).toBeInTheDocument();
	});

	it('calls oncopy with the invite URL when copy is clicked', async () => {
		const oncopy = vi.fn();
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite(), revoking: false, oncopy }
		});
		await screen.getByRole('button', { name: 'Copy invite link' }).click();
		expect(oncopy).toHaveBeenCalledWith('https://app.example.com/invites/abc123');
	});

	it('calls onrevoke with the invite ID when revoke is clicked', async () => {
		const onrevoke = vi.fn();
		const screen = render(InviteLinkRow, {
			props: { invite: createInvite(), revoking: false, onrevoke }
		});
		await screen.getByRole('button', { name: 'Revoke invite link' }).click();
		expect(onrevoke).toHaveBeenCalledWith('inv-1');
	});

	it('disables the revoke button while revoking', async () => {
		const screen = render(InviteLinkRow, { props: { invite: createInvite(), revoking: true } });
		const revoke = screen.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Revoke invite link"]'
		);
		expect(revoke?.disabled).toBe(true);
	});

	it('renders use rows when expanded', async () => {
		const invite = createInvite({
			uses: [
				{
					usedAt: '2025-06-01T00:00:00Z',
					user: {
						id: 'u-2',
						email: 'joiner@example.com',
						displayName: 'Joiner',
						avatarUrl: null
					}
				}
			]
		});
		const screen = render(InviteLinkRow, { props: { invite, revoking: false } });

		// The use-count toggle only renders when uses.length > 0.
		await screen.getByRole('button', { name: '1' }).click();

		await expect.element(screen.getByText('Joiner', { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText('joiner@example.com')).toBeInTheDocument();
	});
});
