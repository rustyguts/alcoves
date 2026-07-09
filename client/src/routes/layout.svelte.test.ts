import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import { toast as sonnerToast } from 'svelte-sonner';
import Layout from './+layout.svelte';
import { auth } from '$lib/state/auth.svelte';
import { toast } from '$lib/state/toast';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

const pageChild = () =>
	createRawSnippet(() => ({
		render: () => '<main data-testid="page">content</main>'
	}));

beforeEach(() => {
	auth.setUser(null);
	// Clear any toasts left over from a previous test so each case starts clean.
	sonnerToast.dismiss();
});

describe('root +layout', () => {
	it('renders page children and marks the app interactive on mount', async () => {
		const screen = render(Layout, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			props: { data: { user: null }, children: pageChild() } as any
		});
		expect(screen.container.querySelector('[data-testid="page"]')).not.toBeNull();
		expect(window.__alcovesReady).toBe(true);
	});

	it('seeds the auth store from data.user when a user is resolved', async () => {
		const user = { id: 'u1', email: 'a@b.co', displayName: 'Ada' };
		render(Layout, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			props: { data: { user }, children: pageChild() } as any
		});
		await vi.waitFor(() => {
			expect(auth.user).toEqual(user);
			expect(auth.loggedIn).toBe(true);
		});
	});

	it('clears the auth store when data.user is null', async () => {
		auth.setUser({
			id: 'stale',
			email: 's@b.co',
			displayName: 'Stale',
			avatarUrl: null,
			role: 'member'
		});
		render(Layout, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			props: { data: { user: null }, children: pageChild() } as any
		});
		await vi.waitFor(() => {
			expect(auth.user).toBeNull();
			expect(auth.loggedIn).toBe(false);
		});
	});

	it('renders queued toasts through the svelte-sonner Toaster', async () => {
		render(Layout, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			props: { data: { user: null }, children: pageChild() } as any
		});
		toast.success('Saved', 'Your changes were saved');
		await vi.waitFor(() => {
			expect(document.body.textContent).toContain('Saved');
			expect(document.body.textContent).toContain('Your changes were saved');
		});
		// The Toaster is rendered with `closeButton`, so every toast gets one.
		expect(document.querySelector('[data-close-button]')).not.toBeNull();
	});
});
