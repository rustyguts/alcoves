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
		// Below `sm` the view toggle collapses into the "More actions" overflow
		// menu (mobile header crowding fix) instead of its own labeled button.
		if (isMobile()) {
			await page.getByRole('button', { name: 'More actions' }).click();
			await page.getByRole('menuitemradio', { name: 'Grid view' }).click();
		} else {
			await page.getByRole('button', { name: 'Grid view' }).click();
		}
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
		// Every screenshots.sh invocation's setup login mints a fresh session, so
		// the "Active sessions" count/list would differ between an --update run
		// and the compare run that follows — on the stacked mobile layout that
		// shifts every section below it. Make session state deterministic first:
		// keep only the session this run is on (there is no bulk "revoke others"
		// endpoint, so enumerate and delete). All four visual projects share the
		// same storageState session, so the kept session survives the whole run.
		const sessions: Array<{ id: string; isCurrent: boolean }> = await (
			await page.request.get('/api/auth/sessions')
		).json();
		for (const s of sessions) {
			if (!s.isCurrent) {
				await page.request.delete(`/api/auth/sessions/${s.id}`);
			}
		}
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

	// ── Editor views ─────────────────────────────────────────────────────────────
	test('video editor — workspace', async ({ page }) => {
		// Seeded "Podcast Recordings" library: episode-01-welcome.mp4 (6s, transcript
		// + waveform ready). Resolved over the API (shares the storageState session
		// cookie) so the test never hardcodes seed UUIDs — same approach as
		// editor.e2e.ts.
		const libraries = await (await page.request.get('/api/libraries')).json();
		const podcast = libraries.find((l: { name: string }) => /Podcast/i.test(l.name));
		expect(podcast, 'seeded Podcast Recordings library').toBeTruthy();
		const listing = await (
			await page.request.get(`/api/libraries/${podcast.id}/files?limit=100`)
		).json();
		const episode = listing.entries.find(
			(f: { name: string }) => f.name === 'episode-01-welcome.mp4'
		);
		expect(episode, 'seeded episode-01-welcome.mp4').toBeTruthy();

		await page.goto(`/libraries/${podcast.id}/edit/${episode.id}`);
		await settle(page);
		await expect(page.getByTestId('timeline')).toBeVisible({ timeout: 15_000 });
		// The editor only settles into its final layout once the player has
		// surfaced the file's duration — before that, seek/zoom math (and the
		// transport timecode) is parked at zero.
		await expect(page.getByTestId('transport-timecode')).not.toHaveText(/\/ 0:00\.0$/, {
			timeout: 15_000
		});
		await expect(page.getByTestId('waveform-track')).toBeVisible({ timeout: 15_000 });

		await expect(page).toHaveScreenshot('editor-workspace.png', {
			// Vidstack's `<media-player>` decodes and paints the first video frame
			// itself — that's nondeterministic across environments/codecs, so mask
			// the player surface on top of the standard dynamic-content masks.
			mask: [...masks(page), page.locator('media-player')]
		});
	});

	test('document editor — split view', async ({ page }) => {
		// Seeded "Travel 2025" library: trip-notes.md (first open seeds the CRDT
		// from the blob). Resolved over the API like documents.e2e.ts.
		const libraries = await (await page.request.get('/api/libraries')).json();
		const travel = libraries.find((l: { name: string }) => l.name === 'Travel 2025');
		expect(travel, 'seeded Travel 2025 library').toBeTruthy();
		const listing = await (
			await page.request.get(`/api/libraries/${travel.id}/files?limit=100`)
		).json();
		const doc = listing.entries.find((f: { name: string }) => f.name === 'trip-notes.md');
		expect(doc, 'seeded trip-notes.md').toBeTruthy();

		await page.goto(`/libraries/${travel.id}/doc/${doc.id}`);
		await settle(page);
		await expect(page.locator('.cm-content')).toContainText('Trip Notes', { timeout: 15_000 });
		// The owner opens in "Edit" mode by default — click into Split explicitly
		// so the baseline doesn't depend on that default.
		await page.getByRole('tab', { name: 'Split', exact: true }).click();
		await expect(page.getByTestId('markdown-preview')).toBeVisible({ timeout: 15_000 });
		// Wait for the save queue to settle so the status label (and anything it
		// affects) is in its final state before the shot.
		await expect(page.getByTestId('doc-status')).toHaveText('All changes saved', {
			timeout: 15_000
		});

		await expect(page).toHaveScreenshot('doc-editor.png', { mask: masks(page) });
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
