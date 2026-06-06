import { type Page, type Locator, expect } from '@playwright/test';

/**
 * Wait until a page is visually stable enough to screenshot deterministically:
 * hydration done, in-flight spinners gone, images decoded. Each step is
 * best-effort (a stuck poll/websocket must not hang the capture).
 */
export async function settle(page: Page): Promise<void> {
	await page
		.waitForFunction(
			() => (window as unknown as { __alcovesReady?: boolean }).__alcovesReady === true,
			undefined,
			{
				timeout: 20_000
			}
		)
		.catch(() => {});
	// Loading spinners use `animate-spin`; skeletons use `animate-pulse`. Both must
	// resolve to a stable frame (toHaveScreenshot disables animation, but we still
	// want the data, not the placeholder).
	await expect(page.locator('.animate-spin'))
		.toHaveCount(0, { timeout: 15_000 })
		.catch(() => {});
	await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
	// Force every <img> to finish decoding so thumbnails don't pop in mid-shot.
	await page
		.evaluate(async () => {
			await Promise.all(
				Array.from(document.images).map((img) =>
					img.complete ? Promise.resolve() : img.decode().catch(() => {})
				)
			);
		})
		.catch(() => {});
}

/** Dynamic regions (relative timestamps, etc.) that must be masked for stability. */
export function masks(page: Page): Locator[] {
	return [page.locator('[data-screenshot-mask]')];
}

/** Navigate, settle, and assert a full-page screenshot with dynamic content masked. */
export async function shot(page: Page, path: string, name: string): Promise<void> {
	await page.goto(path);
	await settle(page);
	await expect(page).toHaveScreenshot(name, { mask: masks(page), fullPage: false });
}

/** Resolve the seeded default library id by following the home redirect. */
export async function defaultLibraryId(page: Page): Promise<string> {
	await page.goto('/');
	await page.waitForURL(/\/libraries\/[^/?]+/, { timeout: 15_000 });
	return page.url().match(/\/libraries\/([^/?]+)/)?.[1] ?? '';
}
