import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';

const gotoMock = vi.hoisted(() => vi.fn());
const invalidateAllMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const createMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ id: 'new' })));
const logoutMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('$app/state', () => ({
	page: { params: {}, url: new URL('http://localhost/libraries/L1'), data: {} }
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock, invalidateAll: invalidateAllMock }));
vi.mock('$lib/api', () => ({
	api: { libraries: { create: createMock } },
	apiUrl: (p: string) => p
}));
vi.mock('$lib/state/auth.svelte', () => ({ auth: { logout: logoutMock } }));
// Keep the WebSocket + activity stack out of the shell test by stubbing the
// stores NotificationBell drives on mount; the bell still renders harmlessly.
vi.mock('$lib/state/notifications.svelte', () => ({
	notifications: {
		get unreadCount() {
			return 0;
		},
		get entries() {
			return [];
		},
		get nextCursor() {
			return null;
		},
		get loading() {
			return false;
		},
		refreshUnreadCount: () => Promise.resolve(),
		loadFirst: () => Promise.resolve(),
		dismiss: vi.fn(),
		dismissAll: () => Promise.resolve(),
		prependLive: vi.fn()
	}
}));
vi.mock('$lib/state/notifications-socket.svelte', () => ({
	notificationsSocket: { connect: vi.fn(), onActivity: vi.fn() }
}));

import Layout from './+layout.svelte';
import type { AuthUser, Library } from '$lib/types/api';

const user: AuthUser = {
	id: 'u1',
	email: 'test@alcoves.io',
	displayName: 'Test User',
	avatarUrl: null,
	role: 'owner'
};

const libraries: Library[] = [
	{
		id: 'L1',
		name: 'Family Photos',
		emoji: null,
		isDefault: true,
		faceRecognitionEnabled: false,
		ownerId: 'u1'
	} as Library
];

function renderShell() {
	const children = createRawSnippet(() => ({
		render: () => '<div data-testid="page-content">page body</div>'
	}));
	return render(Layout, {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		props: { data: { user, libraries }, children } as any
	});
}

function searchInput(screen: ReturnType<typeof renderShell>): HTMLInputElement {
	const input = screen.container.querySelector<HTMLInputElement>('input[type="search"]');
	if (!input) throw new Error('search input not found');
	return input;
}

beforeEach(() => vi.clearAllMocks());

describe('(app) dashboard shell +layout', () => {
	it('renders the brand, the sidebar nav, and the page children', async () => {
		const screen = renderShell();
		expect(screen.container.querySelector('[data-testid="page-content"]')).not.toBeNull();
		// SidebarLibraryNav renders the current library's actions (Files…). It
		// appears twice — desktop sidebar + mobile drawer — so target the first.
		await expect.element(screen.getByText('Files').first()).toBeInTheDocument();
		// Brand appears (desktop sidebar + drawer); at least one is present.
		expect(screen.container.querySelectorAll('img[alt="Alcoves"]').length).toBeGreaterThan(0);
	});

	it('seeds the search box from ?q and navigates to /search on submit', async () => {
		const screen = renderShell();
		const input = searchInput(screen);
		// Seeded from the mocked URL (no q) → starts empty.
		expect(input.value).toBe('');
		input.value = 'beach';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.form?.requestSubmit();
		expect(gotoMock).toHaveBeenCalledWith('/search?q=beach');
	});

	it('navigates to a bare /search when the query is blank', async () => {
		const screen = renderShell();
		const input = searchInput(screen);
		input.value = '   ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.form?.requestSubmit();
		expect(gotoMock).toHaveBeenCalledWith('/search');
	});

	it('opens the user menu and signs out via the auth store', async () => {
		const screen = renderShell();
		await screen.getByRole('button', { name: 'User menu' }).click();
		await screen.getByText('Sign out').click();
		expect(logoutMock).toHaveBeenCalledOnce();
	});

	it('opens the user menu and routes to /profile', async () => {
		const screen = renderShell();
		await screen.getByRole('button', { name: 'User menu' }).click();
		await screen.getByText('Profile').click();
		expect(gotoMock).toHaveBeenCalledWith('/profile');
	});
});
