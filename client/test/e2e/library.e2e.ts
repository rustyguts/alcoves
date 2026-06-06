import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

// The dashboard renders the sidebar nav twice (desktop <aside> + a mobile drawer
// that stays mounted-but-hidden), so target the VISIBLE copy with .filter({ visible }).
test.describe('library browser (full stack)', () => {
	test('logging in lands on a seeded library with content', async ({ page }) => {
		await login(page);
		// Home redirects to the default library; the URL should be a library route.
		await expect(page).toHaveURL(/\/libraries\//, { timeout: 15_000 });
		// The seeded "Family Photos" library appears in the sidebar switcher/nav.
		await expect(
			page
				.getByText(/Family Photos/i)
				.filter({ visible: true })
				.first()
		).toBeVisible();
	});

	test('the sidebar exposes the library feature tabs', async ({ page }) => {
		await login(page);
		await expect(page).toHaveURL(/\/libraries\//, { timeout: 15_000 });
		for (const label of ['Timeline', 'Map', 'People']) {
			await expect(
				page
					.getByRole('link', { name: new RegExp(label, 'i') })
					.filter({ visible: true })
					.first()
			).toBeVisible();
		}
	});

	test('navigating to the Timeline tab renders the timeline route', async ({ page }) => {
		await login(page);
		await expect(page).toHaveURL(/\/libraries\//, { timeout: 15_000 });
		await page
			.getByRole('link', { name: /timeline/i })
			.filter({ visible: true })
			.first()
			.click();
		await expect(page).toHaveURL(/\/timeline$/, { timeout: 15_000 });
	});
});
