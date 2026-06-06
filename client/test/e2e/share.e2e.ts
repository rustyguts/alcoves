import { test, expect } from '@playwright/test';

// Public, SSR-rendered moment share page — no auth. The seed creates a share
// with token "devseedshare01" (backend/internal/seed).
test.describe('public share page (SSR, full stack)', () => {
	test('renders the shared moment landing with OG meta', async ({ page }) => {
		const res = await page.goto('/s/devseedshare01');
		expect(res?.status()).toBeLessThan(400);
		// SSR injects an og:title meta tag from the share metadata.
		await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
	});

	test('an unknown share token 404s', async ({ page }) => {
		const res = await page.goto('/s/does-not-exist-token');
		expect(res?.status()).toBe(404);
	});
});
