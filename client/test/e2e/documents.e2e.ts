import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * Live Documents against the real seeded stack. Seed roles (backend/internal/seed):
 * test@alcoves.io owns everything; bob@ is ADMIN on Podcast Recordings and alice@
 * is VIEWER on Travel 2025. Multi-user tests must use those two libraries —
 * Family Photos is a DEFAULT library, and default libraries are never
 * collaborative (services/access), so members get 404s there.
 * CRDT sync is asynchronous — web-first assertions with generous timeouts, no sleeps.
 */

/** The sidebar shows the CURRENT library's sections (switching goes through a
 * popover), so resolve library ids over the API — the request context shares
 * the page's session cookie — and navigate directly. */
async function gotoLibrary(page: Page, name: string) {
	const res = await page.request.get('/api/libraries');
	const libs = (await res.json()) as Array<{ id: string; name: string }>;
	const lib = libs.find((l) => l.name === name);
	if (!lib) throw new Error(`Library "${name}" not found in /api/libraries`);
	await page.goto(`/libraries/${lib.id}`);
	await page.waitForFunction(() => window.__alcovesReady === true, undefined, {
		timeout: 20_000
	});
}

async function openFamilyPhotos(page: Page) {
	await login(page);
	await gotoLibrary(page, 'Family Photos');
}

/** Create a doc via the toolbar and land in the editor; returns its URL. */
async function createDocument(page: Page, name: string): Promise<string> {
	await page.getByRole('button', { name: 'Document' }).click();
	await page.locator('#create-document-name').fill(name);
	await page.getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL(/\/doc\//, { timeout: 15_000 });
	await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 });
	return page.url();
}

test.describe('live documents (full stack)', () => {
	test('create a document, type, and persist across reload', async ({ page }) => {
		await openFamilyPhotos(page);
		await createDocument(page, `E2E Persist ${Date.now()}`);

		await page.locator('.cm-content').click();
		await page.keyboard.type('# Persistence check');
		await expect(page.locator('.cm-content')).toContainText('Persistence check');
		await expect(page.getByTestId('doc-status')).toHaveText('All changes saved', {
			timeout: 15_000
		});

		// Reload replays the update log — content survives without any explicit save.
		await page.reload();
		await expect(page.locator('.cm-content')).toContainText('Persistence check', {
			timeout: 15_000
		});
	});

	test('edits sync live between two users with presence', async ({ page, browser }) => {
		// Record doc WebSockets that actually OPEN. Presence (cursors/avatars)
		// rides awareness frames over the WS; in a single-port deployment the
		// proxy can't upgrade, sync falls back to HTTP polling, and presence is
		// structurally unavailable — so those assertions are gated below.
		// (CI runs against the compose stack with PUBLIC_API_ORIGIN, where the
		// WS path is exercised for real.)
		await page.addInitScript(() => {
			const opened: string[] = [];
			(window as unknown as { __openDocSockets: string[] }).__openDocSockets = opened;
			const Orig = window.WebSocket;
			window.WebSocket = class extends Orig {
				constructor(url: string | URL, protocols?: string | string[]) {
					super(url, protocols);
					this.addEventListener('open', () => {
						if (String(url).includes('/doc/ws')) opened.push(String(url));
					});
				}
			};
		});
		await login(page);
		await gotoLibrary(page, 'Podcast Recordings');
		const docUrl = await createDocument(page, `E2E Multiplayer ${Date.now()}`);

		// Second, fully isolated browser session as bob (admin on Podcast Recordings).
		const bobContext = await browser.newContext();
		const bobPage = await bobContext.newPage();
		try {
			await login(bobPage, 'bob@alcoves.io');
			await bobPage.goto(docUrl);
			await bobPage.waitForFunction(() => window.__alcovesReady === true, undefined, {
				timeout: 20_000
			});
			await expect(bobPage.locator('.cm-content')).toBeVisible({ timeout: 15_000 });

			// Owner types — bob sees it stream in.
			const sentinel = `sync-check-${Date.now()}`;
			await page.locator('.cm-content').click();
			await page.keyboard.type(sentinel);
			await expect(bobPage.locator('.cm-content')).toContainText(sentinel, {
				timeout: 15_000
			});

			// Bob types back — the owner converges too.
			await bobPage.locator('.cm-content').click();
			await bobPage.keyboard.press('End');
			await bobPage.keyboard.type(' and hello from bob');
			await expect(page.locator('.cm-content')).toContainText('hello from bob', {
				timeout: 15_000
			});

			// Presence: only assertable when the doc WS actually opened (see the
			// init-script comment above).
			const wsLive = await page
				.waitForFunction(
					() => (window as unknown as { __openDocSockets?: string[] }).__openDocSockets!.length > 0,
					undefined,
					{ timeout: 5_000 }
				)
				.then(() => true)
				.catch(() => false);
			if (wsLive) {
				await expect(page.locator('.cm-ySelectionCaret').first()).toBeVisible({
					timeout: 15_000
				});
				await expect(page.getByTestId('doc-peers')).toBeVisible({ timeout: 15_000 });
				await expect(page.locator('[data-testid="doc-peer"]').first()).toHaveAttribute(
					'title',
					/Bob/i
				);
			} else {
				console.log(
					'doc WS unavailable (single-port deployment) — presence assertions skipped; sync verified via polling'
				);
			}
		} finally {
			await bobContext.close();
		}
	});

	test('viewers get a live read-only view', async ({ page, browser }) => {
		await login(page);
		await gotoLibrary(page, 'Travel 2025');
		const docUrl = await createDocument(page, `E2E Viewer ${Date.now()}`);
		await page.locator('.cm-content').click();
		await page.keyboard.type('initial content');
		await expect(page.getByTestId('doc-status')).toHaveText('All changes saved', {
			timeout: 15_000
		});

		// Alice is a viewer on Travel 2025.
		const aliceContext = await browser.newContext();
		const alicePage = await aliceContext.newPage();
		try {
			await login(alicePage, 'alice@alcoves.io');
			await alicePage.goto(docUrl);
			await alicePage.waitForFunction(() => window.__alcovesReady === true, undefined, {
				timeout: 20_000
			});

			// Viewers land on the rendered preview with a read-only badge.
			await expect(alicePage.getByTestId('doc-status')).toHaveText('Read-only', {
				timeout: 15_000
			});
			await expect(alicePage.getByTestId('markdown-preview')).toContainText('initial content', {
				timeout: 15_000
			});

			// The source pane is not editable for viewers.
			await alicePage.getByRole('tab', { name: 'Source' }).click();
			const aliceEditor = alicePage.locator('.cm-content');
			await expect(aliceEditor).toBeVisible({ timeout: 15_000 });
			await expect(aliceEditor).toHaveAttribute('contenteditable', 'false');

			// The owner's edits still stream into alice's read-only view.
			await page.locator('.cm-content').click();
			await page.keyboard.press('End');
			const sentinel = ` viewer-sync-${Date.now()}`;
			await page.keyboard.type(sentinel);
			await expect(aliceEditor).toContainText(sentinel.trim(), { timeout: 15_000 });
		} finally {
			await aliceContext.close();
		}
	});

	test('the seeded trip-notes markdown opens in the editor from the explorer', async ({ page }) => {
		await login(page);
		await gotoLibrary(page, 'Travel 2025');

		// Clicking the seeded .md opens the collaborative editor (first open
		// seeds the CRDT from the blob).
		await page.getByText('trip-notes.md').filter({ visible: true }).first().dblclick();
		await expect(page).toHaveURL(/\/doc\//, { timeout: 15_000 });
		await expect(page.locator('.cm-content')).toContainText('Trip Notes', { timeout: 15_000 });
		await expect(page.getByTestId('doc-status')).toHaveText(/All changes saved|Saving…/, {
			timeout: 15_000
		});

		// Preview renders the markdown.
		await page.getByRole('tab', { name: 'Preview', exact: true }).click();
		await expect(
			page.getByTestId('markdown-preview').getByRole('heading', { name: /Trip Notes/ })
		).toBeVisible({ timeout: 15_000 });
	});
});
