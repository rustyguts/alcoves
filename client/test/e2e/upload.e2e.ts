import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

// 1×1 transparent PNG — a tiny, valid image so the real backend accepts and
// processes the upload without special-casing the file type.
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

// Full-stack upload flow against the seeded backend: queue a file through the
// modal, watch the app-wide upload panel report progress, and confirm the file
// lands in the library once the queue drains.
test.describe('upload queue (full stack)', () => {
	test('uploads a file via the modal and the global panel reports it to completion', async ({
		page
	}) => {
		await login(page);
		await expect(page).toHaveURL(/\/libraries\//, { timeout: 15_000 });

		// Unique name so the file is unambiguous in both the panel and the grid.
		const name = `e2e-upload-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;

		// Open the upload modal via the toolbar's Create dropdown.
		await page.getByRole('button', { name: 'Create' }).click();
		await page.getByRole('menuitem', { name: 'Upload' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });

		await dialog.locator('input[type="file"]').setInputFiles({
			name,
			mimeType: 'image/png',
			buffer: TINY_PNG
		});
		await expect(dialog.getByText(/1 file selected/i)).toBeVisible();

		// Submit — queues onto the global upload queue and closes the modal.
		await dialog.getByRole('button', { name: 'Upload' }).click();

		// The app-wide panel appears bottom-right and shows this file.
		const panel = page.getByRole('region', { name: 'Upload progress' });
		await expect(panel).toBeVisible({ timeout: 15_000 });
		await expect(panel.getByText(name)).toBeVisible({ timeout: 15_000 });

		// Once everything finishes the done items are swept and the panel hides.
		await expect(panel).toBeHidden({ timeout: 45_000 });

		// The uploaded file is now part of the library (the browser auto-refreshes
		// after its uploads complete).
		await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
	});

	test('the panel keeps an in-flight upload visible across navigation', async ({ page }) => {
		await login(page);
		await expect(page).toHaveURL(/\/libraries\//, { timeout: 15_000 });

		// Slow the TUS requests so the upload is genuinely still in flight when we
		// navigate — otherwise tiny files finish instantly and the assertion is vacuous.
		await page.route('**/api/tus**', async (route) => {
			await new Promise((r) => setTimeout(r, 2000));
			await route.continue();
		});

		const name = `e2e-nav-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;

		await page.getByRole('button', { name: 'Create' }).click();
		await page.getByRole('menuitem', { name: 'Upload' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		await dialog.locator('input[type="file"]').setInputFiles({
			name,
			mimeType: 'image/png',
			buffer: TINY_PNG
		});
		await dialog.getByRole('button', { name: 'Upload' }).click();

		const panel = page.getByRole('region', { name: 'Upload progress' });
		await expect(panel).toBeVisible({ timeout: 15_000 });

		// Navigate to the Timeline tab while the upload is still in flight — the queue
		// panel is mounted on the (app) layout, so it must stay visible (and still show
		// this file) across the in-app navigation.
		await page
			.getByRole('link', { name: /timeline/i })
			.filter({ visible: true })
			.first()
			.click();
		await expect(page).toHaveURL(/\/timeline$/, { timeout: 15_000 });
		// The guarantee under test: the still-uploading panel and its file persist
		// across the in-app navigation (the panel lives on the layout, not the page).
		await expect(panel).toBeVisible();
		await expect(panel.getByText(name)).toBeVisible();

		// Stop throttling so the in-flight upload can drain on context teardown.
		await page.unroute('**/api/tus**');
	});
});
