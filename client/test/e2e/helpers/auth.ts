import { type Page, expect } from '@playwright/test';

/** Seed credentials (backend/internal/seed): an owner/admin user. */
export const SEED_EMAIL = 'test@alcoves.io';
export const SEED_PASSWORD = 'password123';

/**
 * Log in through the real /login form against the live backend. Leaves the page
 * on the post-login destination (home → default library).
 */
export async function login(page: Page, email = SEED_EMAIL, password = SEED_PASSWORD) {
	await page.goto('/login');
	// Wait for hydration before interacting: the app.html form guard blocks native
	// <form> submits until the app is interactive (window.__alcovesReady).
	await page.waitForFunction(() => window.__alcovesReady === true, undefined, { timeout: 20_000 });
	await page.locator('input[type="email"]').fill(email);
	await page.locator('input[type="password"]').fill(password);
	await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
	// Successful auth navigates away from /login.
	await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}
