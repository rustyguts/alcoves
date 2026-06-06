import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { InviteLookupResponse } from '$lib/types/api';

const mocks = vi.hoisted(() => ({
	lookup: vi.fn(),
	accept: vi.fn(),
	goto: vi.fn(),
	refreshLibraries: vi.fn().mockResolvedValue(undefined),
	toastAdd: vi.fn(),
	fetchSession: vi.fn().mockResolvedValue(undefined),
	loggedIn: true
}));

vi.mock('$app/state', () => ({
	page: {
		params: { token: 'abc123' },
		url: new URL('http://localhost/invites/abc123'),
		data: {}
	}
}));

vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => mocks.goto(...args),
	invalidateAll: vi.fn()
}));

vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		api: {
			invites: {
				lookup: (...a: unknown[]) => mocks.lookup(...a),
				accept: (...a: unknown[]) => mocks.accept(...a)
			}
		}
	};
});

vi.mock('$lib/state/auth.svelte', () => ({
	auth: {
		get loggedIn() {
			return mocks.loggedIn;
		},
		fetchSession: (...a: unknown[]) => mocks.fetchSession(...a)
	}
}));

vi.mock('$lib/state/libraries-list.svelte', () => ({
	refreshLibraries: (...a: unknown[]) => mocks.refreshLibraries(...a)
}));

vi.mock('$lib/state/toast', () => ({
	toast: { add: (...a: unknown[]) => mocks.toastAdd(...a) }
}));

import Page from './+page.svelte';
import { ApiError } from '$lib/api';

function makeInvite(overrides: Partial<InviteLookupResponse> = {}): InviteLookupResponse {
	return {
		id: 'inv-1',
		status: 'pending',
		canAccept: true,
		createdAt: '2025-01-01T00:00:00Z',
		expiresAt: null,
		maxUses: null,
		useCount: 0,
		invitedBy: { id: 'u-owner', displayName: 'Owner', avatarUrl: null },
		library: { id: 'lib-1', name: 'My Library' },
		...overrides
	};
}

/** Wait until the onMount lookup promise chain settles and DOM reflects it. */
async function settle() {
	await vi.waitFor(() => expect(mocks.lookup).toHaveBeenCalled());
	await tick();
	await tick();
}

describe('invites/[token] +page.svelte', () => {
	beforeEach(() => {
		mocks.loggedIn = true;
		mocks.lookup.mockReset().mockResolvedValue(makeInvite());
		mocks.accept.mockReset().mockResolvedValue({ libraryId: 'lib-1', libraryName: 'My Library' });
		mocks.goto.mockReset();
		mocks.refreshLibraries.mockReset().mockResolvedValue(undefined);
		mocks.toastAdd.mockReset();
		mocks.fetchSession.mockReset().mockResolvedValue(undefined);
	});

	it('looks up the invite and renders the inviter + library title', async () => {
		const screen = render(Page);
		await settle();
		await expect
			.element(screen.getByText('Owner has invited you to join My Library'))
			.toBeInTheDocument();
		expect(mocks.lookup).toHaveBeenCalledWith('abc123');
	});

	it('shows the pending status message and an accept button', async () => {
		const screen = render(Page);
		await settle();
		await expect
			.element(screen.getByText('Accept this invitation to get access to the library.'))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: /Accept Invite/i }))
			.toBeInTheDocument();
	});

	it('hides the accept button when canAccept is false', async () => {
		mocks.lookup.mockResolvedValue(makeInvite({ status: 'already_member', canAccept: false }));
		const screen = render(Page);
		await settle();
		await expect
			.element(screen.getByText('You already have access to this library.'))
			.toBeInTheDocument();
		expect(screen.container.textContent).not.toContain('Accept Invite');
	});

	it('shows the revoked status message', async () => {
		mocks.lookup.mockResolvedValue(makeInvite({ status: 'revoked', canAccept: false }));
		const screen = render(Page);
		await settle();
		await expect
			.element(screen.getByText('This invitation was revoked by a library admin.'))
			.toBeInTheDocument();
	});

	it('accepts the invite then refreshes libraries and navigates to the library', async () => {
		const screen = render(Page);
		await settle();
		await screen.getByRole('button', { name: /Accept Invite/i }).click();
		await vi.waitFor(() => expect(mocks.accept).toHaveBeenCalledWith('abc123'));
		expect(mocks.refreshLibraries).toHaveBeenCalled();
		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Joined library', color: 'success' });
		expect(mocks.goto).toHaveBeenCalledWith('/libraries/lib-1');
	});

	it('shows an error toast and re-loads when accept fails', async () => {
		mocks.accept.mockRejectedValueOnce(new ApiError(410, { message: 'Invite expired' }));
		const screen = render(Page);
		await settle();
		mocks.lookup.mockClear();
		await screen.getByRole('button', { name: /Accept Invite/i }).click();
		await vi.waitFor(() =>
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Invite expired', color: 'error' })
		);
		expect(mocks.lookup).toHaveBeenCalledWith('abc123');
	});

	it('redirects anonymous visitors to register with the invite token', async () => {
		mocks.loggedIn = false;
		render(Page);
		await vi.waitFor(() => expect(mocks.fetchSession).toHaveBeenCalled());
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/register?invite=abc123'));
		expect(mocks.lookup).not.toHaveBeenCalled();
	});
});
