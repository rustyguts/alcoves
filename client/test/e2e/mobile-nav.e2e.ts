import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * Regression: a runaway `$effect` on the library settings page (it called
 * `syncDrafts()`, which writes `memberRoleDrafts` — a value it also tracked)
 * threw `effect_update_depth_exceeded`. That broke Svelte's reactivity scheduler
 * for the whole page, so the mobile sidebar hamburger no longer opened the drawer
 * (`sidebarOpen = true` never propagated to the controlled Dialog). Guard both the
 * symptom (hamburger works) and the cause (no effect loop) on the settings page.
 */
test('mobile hamburger opens the sidebar drawer on the settings page', async ({ page }) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));

	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	await page.waitForURL(/\/libraries\/[^/?]+/, { timeout: 15_000 });
	const id = page.url().match(/libraries\/([^/?]+)/)![1];

	await page.goto(`/libraries/${id}/settings`);
	await page.waitForFunction(() => window.__alcovesReady === true, undefined, { timeout: 20_000 });

	await page.getByRole('button', { name: 'Open sidebar' }).click();
	await expect(page.getByRole('navigation', { name: /Library sections/i }).first()).toBeVisible({
		timeout: 5_000
	});

	expect(pageErrors.join('\n')).not.toContain('effect_update_depth_exceeded');
});
