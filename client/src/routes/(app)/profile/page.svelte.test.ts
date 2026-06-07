import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { AuthUser, SessionInfo } from '$lib/types/api';

// ─── Mocks ─────────────────────────────────────────────────────────────────

// Shared mock fns/stores live in vi.hoisted so the hoisted vi.mock factories can
// safely reference them (top-level const refs would otherwise be uninitialized).
const h = vi.hoisted(() => {
	const u: AuthUser = {
		id: 'user-1',
		email: 'user@example.com',
		displayName: 'Test User',
		avatarUrl: null,
		role: 'owner'
	};
	return {
		user: u,
		updateProfile: vi.fn(() => Promise.resolve(u)),
		uploadAvatar: vi.fn(() => Promise.resolve(u)),
		authStore: { user: u as AuthUser | null, updateProfile: vi.fn(), uploadAvatar: vi.fn() },
		themeStore: { preference: 'system' as string, set: vi.fn() },
		toastAdd: vi.fn(),
		listSessions: vi.fn(() => Promise.resolve([] as SessionInfo[])),
		revokeSession: vi.fn(() => Promise.resolve()),
		listTokens: vi.fn(() => Promise.resolve([]))
	};
});

// Wire the store action spies into the store object + theme.set side effect.
h.authStore.updateProfile = h.updateProfile;
h.authStore.uploadAvatar = h.uploadAvatar;
h.themeStore.set = h.themeStore.set.mockImplementation((p: string) => {
	h.themeStore.preference = p;
});

const user = h.user;
const updateProfile = h.updateProfile;
const uploadAvatar = h.uploadAvatar;
const themeSet = h.themeStore.set;
const themeStore = h.themeStore;
const toastAdd = h.toastAdd;
const authStore = h.authStore;
const listSessions = h.listSessions;
const revokeSession = h.revokeSession;
const listTokens = h.listTokens;

vi.mock('$app/state', () => ({
	page: { params: {}, url: new URL('http://localhost/profile'), data: { user: h.user } }
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn()
}));

vi.mock('$lib/state/auth.svelte', () => ({ auth: h.authStore }));
vi.mock('$lib/state/theme.svelte', () => ({ theme: h.themeStore }));
vi.mock('$lib/state/toast', () => ({ toast: { add: h.toastAdd } }));
vi.mock('$lib/api', () => ({
	apiUrl: (p: string) => p,
	ApiError: class ApiError extends Error {
		status: number;
		data: Record<string, unknown> | null;
		constructor(status: number, data: Record<string, unknown> | null) {
			super((data?.message as string) ?? `Request failed with status ${status}`);
			this.status = status;
			this.data = data;
		}
	},
	api: {
		auth: {
			listSessions: (...a: unknown[]) => h.listSessions(...(a as [])),
			revokeSession: (...a: unknown[]) => h.revokeSession(...(a as [])),
			listTokens: (...a: unknown[]) => h.listTokens(...(a as [])),
			createToken: vi.fn(),
			revokeToken: vi.fn()
		},
		oauth: {
			connections: vi.fn(() => Promise.resolve({ connections: [] })),
			revokeConnection: vi.fn()
		}
	}
}));

import Page from './+page.svelte';
import { ApiError as ApiErrorClass } from '$lib/api';

const sessions: SessionInfo[] = [
	{
		id: 's1',
		userAgent: 'Mozilla/5.0 Chrome/120',
		ipAddress: '192.168.1.1',
		createdAt: '2025-06-01T00:00:00Z',
		expiresAt: '2025-07-01T00:00:00Z',
		isCurrent: true
	},
	{
		id: 's2',
		userAgent: 'Mozilla/5.0 Firefox/120',
		ipAddress: '10.0.0.1',
		createdAt: '2025-06-02T00:00:00Z',
		expiresAt: '2025-07-02T00:00:00Z',
		isCurrent: false
	}
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = { data: { user } } as any;

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
	return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as
		| HTMLButtonElement
		| undefined;
}

beforeEach(() => {
	toastAdd.mockClear();
	updateProfile.mockClear();
	uploadAvatar.mockClear();
	revokeSession.mockClear();
	themeSet.mockClear();
	authStore.user = user;
	themeStore.preference = 'system';
	listSessions.mockReset().mockResolvedValue([]);
	listTokens.mockReset().mockResolvedValue([]);
});

describe('/profile +page', () => {
	it('renders the user identity and the editable display name', async () => {
		const screen = render(Page, { props });
		await tick();
		expect(screen.container.textContent).toContain('user@example.com');
		expect(screen.container.textContent).toContain('owner');
		const input = screen.container.querySelector<HTMLInputElement>(
			'input[placeholder="Display name"]'
		);
		expect(input?.value).toBe('Test User');
	});

	it('disables Save when there are no profile changes', async () => {
		const screen = render(Page, { props });
		await tick();
		expect(buttonByText(screen.container, 'Save changes')?.disabled).toBe(true);
	});

	it('enables Save and updates the display name on save', async () => {
		const screen = render(Page, { props });
		await tick();
		const input = screen.container.querySelector<HTMLInputElement>(
			'input[placeholder="Display name"]'
		)!;
		input.value = 'Renamed';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		const save = buttonByText(screen.container, 'Save changes')!;
		expect(save.disabled).toBe(false);
		save.click();

		await vi.waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ displayName: 'Renamed' }));
		await vi.waitFor(() =>
			expect(toastAdd).toHaveBeenCalledWith({ title: 'Profile updated', color: 'success' })
		);
	});

	it('lets the user pick a theme preference', async () => {
		const screen = render(Page, { props });
		await tick();
		const darkBtn = buttonByText(screen.container, 'Dark')!;
		darkBtn.click();
		await tick();
		expect(themeSet).toHaveBeenCalledWith('dark');
	});

	it('lists active sessions and revokes a non-current one', async () => {
		listSessions.mockResolvedValue(sessions);
		const screen = render(Page, { props });

		await vi.waitFor(() => expect(screen.container.textContent).toContain('Firefox'));
		expect(screen.container.textContent).toContain('Chrome');
		expect(screen.container.textContent).toContain('Current');

		const revoke = buttonByText(screen.container, 'Revoke')!;
		revoke.click();

		await vi.waitFor(() => expect(revokeSession).toHaveBeenCalledWith('s2'));
		await vi.waitFor(() =>
			expect(toastAdd).toHaveBeenCalledWith({ title: 'Session revoked', color: 'success' })
		);
	});

	it('shows the empty-state when there are no other sessions', async () => {
		listSessions.mockResolvedValue([]);
		const screen = render(Page, { props });
		await vi.waitFor(() =>
			expect(screen.container.textContent).toContain('No other active sessions')
		);
	});

	it('rejects a non-image avatar selection with an error toast', async () => {
		const screen = render(Page, { props });
		await tick();
		const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const file = new File(['x'], 'a.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
		fileInput.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();
		expect(toastAdd).toHaveBeenCalledWith({
			title: 'Please select an image file',
			color: 'error'
		});
	});

	it('ignores an empty avatar selection (no file chosen)', async () => {
		const screen = render(Page, { props });
		await tick();
		const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
		fileInput.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();
		expect(toastAdd).not.toHaveBeenCalled();
		expect(screen.container.textContent).not.toContain('New photo selected');
	});

	it('rejects an oversized avatar image with an error toast', async () => {
		const screen = render(Page, { props });
		await tick();
		const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const big = new File(['x'], 'huge.png', { type: 'image/png' });
		// Spoof an oversized file (>25MB) without allocating the bytes.
		Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024, configurable: true });
		Object.defineProperty(fileInput, 'files', { value: [big], configurable: true });
		fileInput.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();
		expect(toastAdd).toHaveBeenCalledWith({
			title: 'Avatar image is too large (max 25MB)',
			color: 'error'
		});
		expect(screen.container.textContent).not.toContain('New photo selected');
	});

	it('previews a valid avatar, shows the banner, and discards it', async () => {
		const objectUrl = 'blob:preview-url';
		const createSpy = vi
			.spyOn(URL, 'createObjectURL')
			.mockReturnValue(objectUrl) as unknown as ReturnType<typeof vi.fn>;
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		try {
			const screen = render(Page, { props });
			await tick();
			const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
			const img = new File(['x'], 'me.png', { type: 'image/png' });
			Object.defineProperty(fileInput, 'files', { value: [img], configurable: true });
			fileInput.dispatchEvent(new Event('change', { bubbles: true }));
			await tick();

			// The selected-avatar banner appears and Save becomes enabled.
			expect(screen.container.textContent).toContain('New photo selected');
			expect(createSpy).toHaveBeenCalledWith(img);
			const heroImg = screen.container.querySelector<HTMLImageElement>('header img');
			expect(heroImg?.getAttribute('src')).toBe(objectUrl);
			expect(buttonByText(screen.container, 'Save changes')?.disabled).toBe(false);

			// Discard revokes the preview URL and removes the banner.
			const discard = buttonByText(screen.container, 'Discard')!;
			discard.click();
			await tick();
			expect(revokeSpy).toHaveBeenCalledWith(objectUrl);
			expect(screen.container.textContent).not.toContain('New photo selected');
		} finally {
			createSpy.mockRestore();
			revokeSpy.mockRestore();
		}
	});

	it('revokes the previous preview URL when a second avatar is picked', async () => {
		const createSpy = vi
			.spyOn(URL, 'createObjectURL')
			.mockReturnValueOnce('blob:first')
			.mockReturnValueOnce('blob:second');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		try {
			const screen = render(Page, { props });
			await tick();
			const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
			const first = new File(['a'], 'one.png', { type: 'image/png' });
			Object.defineProperty(fileInput, 'files', { value: [first], configurable: true });
			fileInput.dispatchEvent(new Event('change', { bubbles: true }));
			await tick();

			const second = new File(['b'], 'two.png', { type: 'image/png' });
			Object.defineProperty(fileInput, 'files', { value: [second], configurable: true });
			fileInput.dispatchEvent(new Event('change', { bubbles: true }));
			await tick();

			expect(revokeSpy).toHaveBeenCalledWith('blob:first');
			const heroImg = screen.container.querySelector<HTMLImageElement>('header img');
			expect(heroImg?.getAttribute('src')).toBe('blob:second');
		} finally {
			createSpy.mockRestore();
			revokeSpy.mockRestore();
		}
	});

	it('uploads the selected avatar on save and clears the preview', async () => {
		const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		try {
			const screen = render(Page, { props });
			await tick();
			const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
			const img = new File(['x'], 'me.png', { type: 'image/png' });
			Object.defineProperty(fileInput, 'files', { value: [img], configurable: true });
			fileInput.dispatchEvent(new Event('change', { bubbles: true }));
			await tick();

			const save = buttonByText(screen.container, 'Save changes')!;
			save.click();

			await vi.waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith(img));
			await vi.waitFor(() =>
				expect(toastAdd).toHaveBeenCalledWith({ title: 'Profile updated', color: 'success' })
			);
			// The display name is unchanged, so only the avatar upload runs.
			expect(updateProfile).not.toHaveBeenCalled();
			// Save clears the preview, so the banner is gone afterwards.
			await tick();
			expect(screen.container.textContent).not.toContain('New photo selected');
		} finally {
			createSpy.mockRestore();
			revokeSpy.mockRestore();
		}
	});

	it('surfaces the ApiError message when saving fails', async () => {
		updateProfile.mockRejectedValueOnce(new ApiErrorClass(409, { message: 'Name already taken' }));
		const screen = render(Page, { props });
		await tick();
		const input = screen.container.querySelector<HTMLInputElement>(
			'input[placeholder="Display name"]'
		)!;
		input.value = 'Renamed';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		buttonByText(screen.container, 'Save changes')!.click();
		await vi.waitFor(() =>
			expect(toastAdd).toHaveBeenCalledWith({ title: 'Name already taken', color: 'error' })
		);
	});

	it('falls back to a generic message for a non-ApiError save failure', async () => {
		updateProfile.mockRejectedValueOnce(new Error('boom'));
		const screen = render(Page, { props });
		await tick();
		const input = screen.container.querySelector<HTMLInputElement>(
			'input[placeholder="Display name"]'
		)!;
		input.value = 'Renamed';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		buttonByText(screen.container, 'Save changes')!.click();
		await vi.waitFor(() =>
			expect(toastAdd).toHaveBeenCalledWith({ title: 'Failed to update profile', color: 'error' })
		);
	});

	it('renders the remote avatar image when the user has an avatarUrl', async () => {
		authStore.user = { ...user, avatarUrl: '/avatars/user-1/avatar.webp' };
		const screen = render(Page, { props });
		await tick();
		const heroImg = screen.container.querySelector<HTMLImageElement>('header img');
		expect(heroImg?.getAttribute('src')).toBe('/avatars/user-1/avatar.webp');
	});

	it('opens the file picker when the avatar button is clicked', async () => {
		const screen = render(Page, { props });
		await tick();
		const fileInput = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!;
		const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
		// The first header button is the avatar picker.
		const avatarBtn = screen.container.querySelector<HTMLButtonElement>('header button')!;
		avatarBtn.click();
		expect(clickSpy).toHaveBeenCalled();
	});

	it('renders the fallback placeholder and email-less heading when no user is resolved', async () => {
		authStore.user = null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const screen = render(Page, { props: { data: { user: null } } as any });
		await tick();
		// No avatar src → the initial-letter placeholder is shown instead of an <img>.
		expect(screen.container.querySelector('header img')).toBeNull();
		expect(screen.container.querySelector('span[aria-label="User"]')?.textContent?.trim()).toBe(
			'U'
		);
		expect(screen.container.textContent).toContain('Your profile');
	});

	it('keeps the existing session list when a refresh fails', async () => {
		listSessions.mockResolvedValueOnce(sessions).mockRejectedValueOnce(new Error('network'));
		const screen = render(Page, { props });
		await vi.waitFor(() => expect(screen.container.textContent).toContain('Firefox'));

		const revoke = buttonByText(screen.container, 'Revoke')!;
		revoke.click();
		// Revoke succeeds, then the post-revoke refresh rejects — the list stays.
		await vi.waitFor(() => expect(revokeSession).toHaveBeenCalledWith('s2'));
		await tick();
		expect(screen.container.textContent).toContain('Firefox');
	});

	it('shows an error toast when revoking a session fails', async () => {
		listSessions.mockResolvedValue(sessions);
		revokeSession.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page, { props });
		await vi.waitFor(() => expect(screen.container.textContent).toContain('Firefox'));

		buttonByText(screen.container, 'Revoke')!.click();
		await vi.waitFor(() =>
			expect(toastAdd).toHaveBeenCalledWith({ title: 'Failed to revoke session', color: 'error' })
		);
	});

	it('labels each known browser from its user agent', async () => {
		listSessions.mockResolvedValue([
			{ ...sessions[1], id: 'e', userAgent: 'X Edg/1', isCurrent: false },
			{ ...sessions[1], id: 'sf', userAgent: 'X Safari/1', isCurrent: false },
			{ ...sessions[1], id: 'un', userAgent: 'CustomAgent/1', isCurrent: false },
			{ ...sessions[1], id: 'no', userAgent: null, ipAddress: null, isCurrent: false }
		]);
		const screen = render(Page, { props });
		await vi.waitFor(() => expect(screen.container.textContent).toContain('Edge'));
		const text = screen.container.textContent ?? '';
		expect(text).toContain('Safari');
		expect(text).toContain('Unknown browser');
		expect(text).toContain('Unknown device');
	});
});
