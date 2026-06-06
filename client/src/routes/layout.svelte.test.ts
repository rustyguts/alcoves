import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Layout from './+layout.svelte';
import { auth } from '$lib/state/auth.svelte';
import { toaster } from '$lib/state/toast';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

const pageChild = () =>
	createRawSnippet(() => ({
		render: () => '<main data-testid="page">content</main>'
	}));

beforeEach(() => {
	auth.setUser(null);
	// Clear any toasts left over from a previous test so each case starts clean.
	for (const t of toaster.getVisibleToasts()) toaster.remove(t.id);
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

	it('renders queued toasts through the Toast.Group children snippet', async () => {
		toaster.success({ title: 'Saved', description: 'Your changes were saved' });
		const screen = render(Layout, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			props: { data: { user: null }, children: pageChild() } as any
		});
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Saved');
			expect(screen.container.textContent).toContain('Your changes were saved');
		});
		// A close trigger is rendered for the toast (Toast.CloseTrigger).
		expect(screen.container.querySelector('[data-part="close-trigger"]')).not.toBeNull();
	});
});
