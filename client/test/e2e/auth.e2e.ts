import { test, expect } from '@playwright/test';
import { login, SEED_EMAIL } from './helpers/auth';

test.describe('authentication (full stack)', () => {
	test('an anonymous user is redirected to /login', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login/);
	});

	test('the seed user can log in and reach the authed app', async ({ page }) => {
		await login(page);
		// The dashboard shell renders the global search box.
		await expect(page.locator('input[type="search"]')).toBeVisible();
	});

	test('bad credentials show an error and stay on /login', async ({ page }) => {
		await page.goto('/login');
		// Wait for hydration (the app.html form guard blocks submits until interactive).
		await page.waitForFunction(() => window.__alcovesReady === true, undefined, {
			timeout: 20_000
		});
		await page.locator('input[type="email"]').fill(SEED_EMAIL);
		await page.locator('input[type="password"]').fill('wrong-password');
		await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
		// An error message is surfaced and we stay on /login (no navigation).
		await expect(page.getByText(/invalid|incorrect|wrong|failed/i).first()).toBeVisible();
		await expect(page).toHaveURL(/\/login/);
	});

	test('logging out returns to /login', async ({ page }) => {
		await login(page);
		// Open the user menu and sign out.
		await page
			.getByRole('button', { name: /user menu|account|profile/i })
			.first()
			.click();
		await page.getByRole('button', { name: /sign out|log ?out/i }).click();
		await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
	});
});
