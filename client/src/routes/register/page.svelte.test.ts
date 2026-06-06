import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';

// --- Mocks -----------------------------------------------------------------

const h = vi.hoisted(() => ({
	// A single, STABLE URLSearchParams instance the component's `$derived` reads
	// from. The page object is rebuilt around it per access (cheap), but the
	// searchParams identity is preserved and mutated in place by setQuery —
	// reassigning it would break the closure the hoisted mock captured.
	searchParams: new URLSearchParams(),
	goto: vi.fn(),
	register: vi.fn(),
	providers: vi.fn(),
	registrationMode: vi.fn(),
	inviteLookup: vi.fn()
}));

vi.mock('$app/state', () => ({
	get page() {
		return { params: {}, url: { searchParams: h.searchParams }, data: {} };
	}
}));

vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => h.goto(...args),
	invalidateAll: vi.fn()
}));

vi.mock('$lib/state/auth.svelte', () => ({
	auth: {
		register: (...args: unknown[]) => h.register(...args)
	}
}));

vi.mock('$lib/api', () => ({
	api: {
		auth: { providers: () => h.providers() },
		meta: { registrationMode: () => h.registrationMode() },
		invites: { lookup: (token: string) => h.inviteLookup(token) }
	},
	// OAuthGoogleButton transitively imports apiUrl from $lib/api.
	apiUrl: (path: string) => path
}));

const goto = h.goto;
const register = h.register;
const providers = h.providers;
const registrationMode = h.registrationMode;
const inviteLookup = h.inviteLookup;

import RegisterPage from './+page.svelte';

/** Let onMount's async work + reactive updates settle. */
async function settle() {
	for (let i = 0; i < 10; i++) {
		await tick();
		await Promise.resolve();
	}
}

function setQuery(qs: string) {
	// Mutate the stable instance in place (don't reassign — see the hoist note).
	for (const key of Array.from(h.searchParams.keys())) h.searchParams.delete(key);
	for (const [key, value] of new URLSearchParams(qs)) h.searchParams.set(key, value);
}

describe('register +page.svelte', () => {
	beforeEach(() => {
		goto.mockReset();
		register.mockReset();
		setQuery('');
		providers.mockReset().mockResolvedValue({ google: false });
		registrationMode.mockReset().mockResolvedValue({ mode: 'open' });
		inviteLookup.mockReset();
	});

	it('renders the create-account shell', async () => {
		const screen = render(RegisterPage);
		await settle();
		expect(screen.container.textContent).toContain('Create an account');
		expect(screen.container.textContent).toContain('Get started with Alcoves.');
	});

	it('links to the login page', async () => {
		const screen = render(RegisterPage);
		await settle();
		const links = Array.from(screen.container.querySelectorAll('a'));
		const signIn = links.find((a) => a.textContent?.trim() === 'Sign in');
		expect(signIn).toBeTruthy();
		expect(signIn!.getAttribute('href')).toBe('/login');
	});

	it('registers on submit and navigates home', async () => {
		register.mockResolvedValueOnce(undefined);
		const screen = render(RegisterPage);
		await settle();

		const inputs = screen.container.querySelectorAll('input');
		const [nameInput, emailInput, passwordInput, confirmInput] = inputs as unknown as [
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement
		];

		nameInput.value = 'Test';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		emailInput.value = 'test@example.com';
		emailInput.dispatchEvent(new Event('input', { bubbles: true }));
		passwordInput.value = 'password123';
		passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
		confirmInput.value = 'password123';
		confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		screen.container
			.querySelector('form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		await vi.waitFor(() => {
			expect(register).toHaveBeenCalledWith('Test', 'test@example.com', 'password123', undefined);
		});
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
	});

	it('shows a validation error for mismatched passwords without calling register', async () => {
		const screen = render(RegisterPage);
		await settle();

		const inputs = screen.container.querySelectorAll('input');
		const [nameInput, emailInput, passwordInput, confirmInput] = inputs as unknown as [
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement
		];

		nameInput.value = 'Test';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		emailInput.value = 'test@example.com';
		emailInput.dispatchEvent(new Event('input', { bubbles: true }));
		passwordInput.value = 'password123';
		passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
		confirmInput.value = 'different456';
		confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		screen.container
			.querySelector('form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await settle();

		expect(register).not.toHaveBeenCalled();
		expect(screen.container.textContent).toContain('Passwords do not match');
	});

	it('surfaces the API error message on register failure', async () => {
		register.mockRejectedValueOnce({ data: { message: 'Email taken' } });
		const screen = render(RegisterPage);
		await settle();

		const inputs = screen.container.querySelectorAll('input');
		const [nameInput, emailInput, passwordInput, confirmInput] = inputs as unknown as [
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement
		];
		nameInput.value = 'Test';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		emailInput.value = 'test@example.com';
		emailInput.dispatchEvent(new Event('input', { bubbles: true }));
		passwordInput.value = 'password123';
		passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
		confirmInput.value = 'password123';
		confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		screen.container
			.querySelector('form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		await vi.waitFor(() => expect(screen.container.textContent).toContain('Email taken'));
	});

	it('shows the disabled notice when registration is closed', async () => {
		registrationMode.mockResolvedValueOnce({ mode: 'closed' });
		const screen = render(RegisterPage);
		await settle();
		expect(screen.container.textContent).toContain('Registration disabled');
		expect(screen.container.querySelector('form')).toBeNull();
	});

	it('requires an invite token in invite_only mode', async () => {
		registrationMode.mockResolvedValueOnce({ mode: 'invite_only' });
		const screen = render(RegisterPage);
		await settle();
		expect(screen.container.textContent).toContain('invite-only');
		expect(inviteLookup).not.toHaveBeenCalled();
	});

	it('looks up the invite and shows the form in invite_only mode with a valid token', async () => {
		setQuery('invite=tok-123');
		registrationMode.mockResolvedValueOnce({ mode: 'invite_only' });
		inviteLookup.mockResolvedValueOnce({
			id: 'inv-1',
			status: 'pending',
			canAccept: true,
			library: { id: 'lib-1', name: 'Family Photos' }
		});
		const screen = render(RegisterPage);
		await settle();

		expect(inviteLookup).toHaveBeenCalledWith('tok-123');
		expect(screen.container.textContent).toContain('Family Photos');
		expect(screen.container.querySelector('form')).not.toBeNull();
		// Login link carries the invite token through.
		const links = Array.from(screen.container.querySelectorAll('a'));
		const signIn = links.find((a) => a.textContent?.trim() === 'Sign in');
		expect(signIn!.getAttribute('href')).toContain('invite=tok-123');
	});

	it('passes the invite token to register and routes to the invited library', async () => {
		setQuery('invite=tok-123');
		registrationMode.mockResolvedValueOnce({ mode: 'invite_only' });
		inviteLookup.mockResolvedValueOnce({
			id: 'inv-1',
			status: 'pending',
			canAccept: true,
			library: { id: 'lib-1', name: 'Family Photos' }
		});
		register.mockResolvedValueOnce(undefined);
		const screen = render(RegisterPage);
		await settle();

		const inputs = screen.container.querySelectorAll('input');
		const [nameInput, emailInput, passwordInput, confirmInput] = inputs as unknown as [
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement,
			HTMLInputElement
		];
		nameInput.value = 'Test';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		emailInput.value = 'test@example.com';
		emailInput.dispatchEvent(new Event('input', { bubbles: true }));
		passwordInput.value = 'password123';
		passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
		confirmInput.value = 'password123';
		confirmInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		screen.container
			.querySelector('form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		await vi.waitFor(() => {
			expect(register).toHaveBeenCalledWith('Test', 'test@example.com', 'password123', 'tok-123');
		});
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/libraries/lib-1'));
	});

	it('shows the Google OAuth button when the provider is enabled', async () => {
		providers.mockResolvedValueOnce({ google: true });
		const screen = render(RegisterPage);
		await settle();
		expect(screen.container.textContent).toContain('Continue with Google');
	});
});
