import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ApiError } from '$lib/api';

const goto = vi.hoisted(() => vi.fn());
const login = vi.hoisted(() => vi.fn());

// Default page mock: bare /login URL, no query params. Individual tests rewrite
// `page.url` before importing/rendering as needed.
const pageMock = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/login'),
	data: {}
}));

vi.mock('$app/state', () => ({ page: pageMock }));
vi.mock('$app/navigation', () => ({ goto, invalidateAll: vi.fn() }));
vi.mock('$lib/state/auth.svelte', () => ({ auth: { login } }));

import LoginPage from './+page.svelte';

function fillCredentials(
	screen: ReturnType<typeof render>,
	email = 'test@example.com',
	password = 'password123'
) {
	const emailInput = screen.container.querySelector<HTMLInputElement>('input[type="email"]')!;
	const passwordInput = screen.container.querySelector<HTMLInputElement>('input[type="password"]')!;
	emailInput.value = email;
	emailInput.dispatchEvent(new Event('input', { bubbles: true }));
	passwordInput.value = password;
	passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
	vi.clearAllMocks();
	pageMock.url = new URL('http://localhost/login');
});

describe('/login page', () => {
	it('renders the welcome heading and sign-up link', async () => {
		const screen = render(LoginPage);
		expect(screen.container.textContent).toContain('Welcome back');
		expect(screen.container.textContent).toContain('Sign in to your account');

		const signUp = screen.container.querySelector('a[href="/register"]');
		expect(signUp).not.toBeNull();
		expect(signUp!.textContent).toContain('Sign up');
	});

	it('logs in then navigates to the root by default', async () => {
		login.mockResolvedValueOnce(undefined);
		const screen = render(LoginPage);
		fillCredentials(screen);

		screen.container.querySelector('form')!.requestSubmit();

		await vi.waitFor(() => {
			expect(login).toHaveBeenCalledWith('test@example.com', 'password123');
			expect(goto).toHaveBeenCalledWith('/');
		});
	});

	it('honors an in-app ?redirect target after login', async () => {
		pageMock.url = new URL('http://localhost/login?redirect=/libraries/lib-1');
		login.mockResolvedValueOnce(undefined);
		const screen = render(LoginPage);
		fillCredentials(screen, 'u@example.com');

		screen.container.querySelector('form')!.requestSubmit();

		await vi.waitFor(() => {
			expect(goto).toHaveBeenCalledWith('/libraries/lib-1');
		});
		// The sign-up link carries the redirect along too.
		const signUp = screen.container.querySelector('a[href^="/register"]')!;
		expect(signUp.getAttribute('href')).toBe('/register?redirect=%2Flibraries%2Flib-1');
	});

	it('ignores an off-site ?redirect and falls back to root', async () => {
		pageMock.url = new URL('http://localhost/login?redirect=https://evil.example');
		login.mockResolvedValueOnce(undefined);
		const screen = render(LoginPage);
		fillCredentials(screen);

		screen.container.querySelector('form')!.requestSubmit();

		await vi.waitFor(() => {
			expect(goto).toHaveBeenCalledWith('/');
		});
	});

	it('surfaces the server message from an ApiError on failure', async () => {
		login.mockRejectedValueOnce(new ApiError(401, { message: 'Invalid credentials' }));
		const screen = render(LoginPage);
		fillCredentials(screen);

		screen.container.querySelector('form')!.requestSubmit();

		await vi.waitFor(() => {
			const alert = screen.container.querySelector('[role="alert"]');
			expect(alert).not.toBeNull();
			expect(alert!.textContent).toContain('Invalid credentials');
		});
		expect(goto).not.toHaveBeenCalled();
	});

	it('shows the fallback message for a non-ApiError failure', async () => {
		login.mockRejectedValueOnce(new Error('network'));
		const screen = render(LoginPage);
		fillCredentials(screen);

		screen.container.querySelector('form')!.requestSubmit();

		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Invalid email or password');
		});
	});

	it('shows a Google failure message when ?error=google is present', async () => {
		pageMock.url = new URL('http://localhost/login?error=google');
		const screen = render(LoginPage);

		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Google sign-in failed');
		});
	});

	it('hides the Google button when PUBLIC_GOOGLE_AUTH_ENABLED is unset', async () => {
		const screen = render(LoginPage);
		// OAuthGoogleButton renders an <a> to /api/auth/google; absent by default.
		expect(screen.container.querySelector('a[href*="/api/auth/google"]')).toBeNull();
	});
});
