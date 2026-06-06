import { test, expect } from '@playwright/test';
import { settle, masks, shot, defaultLibraryId } from './helpers/visual';

/**
 * Visual-regression coverage of every page, key flow, and interactive state, run
 * across the desktop/mobile × light/dark project matrix (see playwright.config.ts).
 * Baselines live under test/e2e/__screenshots__/ and are generated + compared in
 * the pinned Playwright container for determinism (scripts/screenshots.sh).
 *
 * Dynamic content (relative timestamps) carries `data-screenshot-mask` and is
 * masked on every shot; dates render via fixed UTC + en-US locale so they're
 * stable. Animations are disabled at capture time by the config.
 */

// Force the theme deterministically before first paint (app.html reads this key),
// so light/dark projects render the right palette with no flash.
test.beforeEach(async ({ context }, testInfo) => {
	const theme = (testInfo.project.metadata as { theme?: string }).theme ?? 'light';
	await context.addInitScript((t) => {
		try {
			localStorage.setItem('alcoves.theme', t);
		} catch {
			/* storage may be unavailable pre-navigation */
		}
	}, theme);
});

const isMobile = () => test.info().project.name.startsWith('mobile');

test.describe('authenticated app', () => {
	test('library — files list view', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}`, 'library-files-list.png');
	});

	test('library — files grid view', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await page.goto(`/libraries/${id}`);
		await settle(page);
		await page.getByRole('button', { name: 'Grid view' }).click();
		await settle(page);
		await expect(page).toHaveScreenshot('library-files-grid.png', { mask: masks(page) });
	});

	test('library — timeline', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}/timeline`, 'library-timeline.png');
	});

	test('library — map', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await page.goto(`/libraries/${id}/map`);
		await settle(page);
		// Leaflet tiles load from a remote/CDN and are nondeterministic — mask the map.
		await expect(page).toHaveScreenshot('library-map.png', {
			mask: [...masks(page), page.locator('.leaflet-container')]
		});
	});

	test('library — tags', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}/tags`, 'library-tags.png');
	});

	test('library — feed', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}/feed`, 'library-feed.png');
	});

	test('library — people', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}/people`, 'library-people.png');
	});

	test('library — person detail', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await page.goto(`/libraries/${id}/people`);
		await settle(page);
		// Person tiles are buttons that open the detail view on double-click.
		const person = page.locator('button.size-40').first();
		if ((await person.count()) === 0) test.skip(true, 'no seeded people');
		await person.dblclick();
		await page.waitForURL(/\/people\/[^/?]+/, { timeout: 15_000 });
		await settle(page);
		await expect(page).toHaveScreenshot('library-person-detail.png', { mask: masks(page) });
	});

	test('library — objects', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}/objects`, 'library-objects.png');
	});

	test('library — settings', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}/settings`, 'library-settings.png');
	});

	test('library — trash (empty state)', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await shot(page, `/libraries/${id}/trash`, 'library-trash.png');
	});

	test('search results', async ({ page }) => {
		await shot(page, '/search?q=photo', 'search.png');
	});

	test('notifications', async ({ page }) => {
		await shot(page, '/notifications', 'notifications.png');
	});

	test('profile', async ({ page }) => {
		await shot(page, '/profile', 'profile.png');
	});

	test('admin dashboard', async ({ page }) => {
		await shot(page, '/admin', 'admin.png');
	});

	test('admin jobs', async ({ page }) => {
		await shot(page, '/admin/jobs', 'admin-jobs.png');
	});

	test('not found (in app shell)', async ({ page }) => {
		await shot(page, '/this-route-does-not-exist', 'not-found-app.png');
	});

	// ── Interactive states ──────────────────────────────────────────────────────
	test('state — create folder modal', async ({ page }) => {
		test.skip(isMobile(), 'desktop toolbar labels');
		const id = await defaultLibraryId(page);
		await page.goto(`/libraries/${id}`);
		await settle(page);
		await page.getByRole('button', { name: 'Folder' }).click();
		await expect(page.getByText('Create Folder')).toBeVisible();
		await expect(page).toHaveScreenshot('state-create-folder-modal.png', { mask: masks(page) });
	});

	test('state — file context menu', async ({ page }) => {
		const id = await defaultLibraryId(page);
		await page.goto(`/libraries/${id}`);
		await settle(page);
		const row = page.locator('tbody tr').first();
		if ((await row.count()) === 0) test.skip(true, 'no rows to right-click');
		await row.click({ button: 'right' });
		await expect(page.locator('[role="menu"]')).toBeVisible();
		await expect(page).toHaveScreenshot('state-context-menu.png', { mask: masks(page) });
	});

	test('state — mobile sidebar drawer', async ({ page }) => {
		test.skip(!isMobile(), 'mobile only');
		const id = await defaultLibraryId(page);
		await page.goto(`/libraries/${id}`);
		await settle(page);
		await page.getByRole('button', { name: 'Open sidebar' }).click();
		await page.waitForTimeout(300);
		await expect(page).toHaveScreenshot('state-mobile-drawer.png', { mask: masks(page) });
	});
});

test.describe('public pages', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('login', async ({ page }) => {
		await shot(page, '/login', 'login.png');
	});

	test('register', async ({ page }) => {
		await shot(page, '/register', 'register.png');
	});

	test('public moment share', async ({ page }) => {
		await shot(page, '/s/devseedshare01', 'share.png');
	});

	test('public share — not found', async ({ page }) => {
		await shot(page, '/s/deadbeef-not-a-real-token', 'share-not-found.png');
	});
});
