import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { login } from './helpers/auth';

// Exercises the MCP OAuth 2.1 custom-connector flow against the REAL seeded
// stack (docker compose enables ALCOVES_MCP_OAUTH_ENABLED for local dev/CI).
// This stands in for Claude's connector: DCR → browser consent → code → token,
// plus the profile "Connected apps" surface.

// A loopback redirect keeps the post-approval navigation on the local origin
// (the backend permits http only for loopback hosts). Derived from the suite's
// base URL — Playwright's default webServer runs the production build on
// :4173, while E2E_BASE_URL points at an already-running stack (e.g. :3000) —
// so the callback navigation always lands on whichever server is actually up.
const APP_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const REDIRECT_URI = new URL('/oauth-test-callback', APP_ORIGIN).toString();
const REDIRECT_HOST = new URL(REDIRECT_URI).host;

function pkce() {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

/** Register a public client via Dynamic Client Registration (RFC 7591). */
async function registerClient(request: import('@playwright/test').APIRequestContext, name: string) {
	const res = await request.post('/api/oauth/register', {
		data: { client_name: name, redirect_uris: [REDIRECT_URI] }
	});
	expect(res.status(), await res.text()).toBe(201);
	return (await res.json()) as { client_id: string };
}

test.describe('MCP OAuth custom-connector flow (full stack)', () => {
	test('DCR → consent → code → token exchange', async ({ page, request }) => {
		await login(page);

		const { client_id } = await registerClient(request, 'Claude E2E');
		const { verifier, challenge } = pkce();

		const params = new URLSearchParams({
			client_id,
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state: 'e2e-state'
		});
		await page.goto(`/oauth/authorize?${params.toString()}`);
		await page.waitForFunction(() => window.__alcovesReady === true, undefined, {
			timeout: 20_000
		});

		// Consent screen renders the client name and the real redirect host.
		await expect(page.getByText('Connect to Alcoves')).toBeVisible();
		await expect(page.getByText(/Claude E2E wants to connect/)).toBeVisible();
		// The real redirect host (with port) is surfaced so an impostor is spottable.
		await expect(page.getByText(REDIRECT_HOST, { exact: true })).toBeVisible();

		// Approve → the browser is sent back to the client's redirect with a code.
		await page.getByRole('button', { name: /approve/i }).click();
		await page.waitForURL(/\/oauth-test-callback\?.*code=/, { timeout: 15_000 });

		const callback = new URL(page.url());
		const code = callback.searchParams.get('code');
		expect(code).toBeTruthy();
		expect(callback.searchParams.get('state')).toBe('e2e-state');

		// Exchange the code (public client, PKCE) for an access token.
		const tokenRes = await request.post('/api/oauth/token', {
			form: {
				grant_type: 'authorization_code',
				client_id,
				code: code!,
				redirect_uri: REDIRECT_URI,
				code_verifier: verifier
			}
		});
		expect(tokenRes.status(), await tokenRes.text()).toBe(200);
		const token = (await tokenRes.json()) as { access_token?: string; token_type?: string };
		expect(token.access_token, 'token exchange should yield an access token').toBeTruthy();
		expect(token.token_type).toBe('Bearer');
	});

	test('denying consent returns access_denied to the client', async ({ page, request }) => {
		await login(page);
		const { client_id } = await registerClient(request, 'Denied E2E');
		const { challenge } = pkce();

		const params = new URLSearchParams({
			client_id,
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state: 'deny-state'
		});
		await page.goto(`/oauth/authorize?${params.toString()}`);
		await page.waitForFunction(() => window.__alcovesReady === true, undefined, {
			timeout: 20_000
		});

		await page.getByRole('button', { name: /deny/i }).click();
		await page.waitForURL(/\/oauth-test-callback\?.*error=access_denied/, { timeout: 15_000 });
	});

	test('profile shows the Connected apps panel when OAuth is enabled', async ({ page }) => {
		await login(page);
		await page.goto('/profile');
		await page.waitForFunction(() => window.__alcovesReady === true, undefined, {
			timeout: 20_000
		});
		// The panel only renders when GET /api/oauth/connections succeeds (i.e. the
		// authorization server is enabled), so its presence verifies the wiring.
		await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible();
	});
});
