import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

// The seed `test@alcoves.io` user is an instance owner, so the owner-gated admin
// area (guarded server-side in admin/+layout.server.ts) must be reachable for
// them. This is a smoke check of the guard's happy path + the dashboard render.
test.describe('admin area (full stack)', () => {
	test('an owner can open the admin dashboard', async ({ page }) => {
		await login(page);
		await page.goto('/admin');
		// The guard redirects non-owners to '/'; the owner stays on /admin.
		await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
		await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({
			timeout: 15_000
		});
	});

	test('the admin dashboard lists seeded users', async ({ page }) => {
		await login(page);
		await page.goto('/admin');
		await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
		// The users panel renders the seeded members (alice/bob are seeded alongside
		// the owner) — assert at least the owner's own email surfaces somewhere.
		await expect(
			page
				.getByText(/test@alcoves\.io/i)
				.filter({ visible: true })
				.first()
		).toBeVisible({ timeout: 15_000 });
	});
});
