import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * Video editor (full stack, real seeded backend).
 *
 * Uses the seeded "Podcast Recordings" library: episode-01-welcome.mp4 (6s,
 * transcript + waveform ready, moments "Cold Open" and "Key Takeaway"). Seed
 * ids are deterministic but resolved through the API here so the test never
 * hardcodes UUIDs. Every moment a test creates gets a unique name and is
 * deleted again — the seed only loads into an empty DB, so leftovers persist
 * across local runs.
 */

async function openEditor(page: Page): Promise<void> {
	await login(page);
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
	await page.waitForFunction(() => window.__alcovesReady === true, undefined, { timeout: 20_000 });
	await expect(page.getByTestId('timeline')).toBeVisible({ timeout: 15_000 });
	// The editor is interactive once the player surfaced the file's duration —
	// before that, seek/zoom math is parked at zero.
	await expect(page.getByTestId('transport-timecode')).not.toHaveText(/\/ 0:00\.0$/, {
		timeout: 15_000
	});
}

/** Select a moment card in the Moments tab by its (unique) name. */
async function selectMomentCard(page: Page, name: string): Promise<void> {
	await page.getByRole('tab', { name: /moments/i }).click();
	await page.getByText(name, { exact: false }).filter({ visible: true }).first().click();
	await expect(page.getByTestId('moment-edit-form')).toBeVisible();
}

/** Delete the currently selected moment through the edit form + confirm modal. */
async function deleteSelectedMoment(page: Page): Promise<void> {
	await page.getByTestId('moment-edit-form').getByRole('button', { name: 'Delete' }).click();
	// ConfirmModal renders a bits-ui AlertDialog portalled to <body>; scope to
	// its content so this doesn't collide with the form's own Delete button.
	await page
		.locator('[data-slot="alert-dialog-content"]')
		.getByRole('button', { name: 'Delete', exact: true })
		.click();
	await expect(page.getByText('Moment deleted').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('video editor (full stack)', () => {
	test('loads the seeded episode with timeline, transport and moments', async ({ page }) => {
		await openEditor(page);

		// Top bar shows the file.
		await expect(page.getByText('episode-01-welcome.mp4').first()).toBeVisible();

		// Transport timecode reflects the 6s duration.
		await expect(page.getByTestId('transport-timecode')).toHaveText(/\/ 0:06\.0/, {
			timeout: 15_000
		});

		// Seeded waveform renders as the audio track.
		await expect(page.getByTestId('waveform-track')).toBeVisible({ timeout: 15_000 });

		// Seeded moments appear in the Moments tab.
		await page.getByRole('tab', { name: /moments/i }).click();
		await expect(page.getByText('Cold Open').first()).toBeVisible();
		await expect(page.getByText('Key Takeaway').first()).toBeVisible();
	});

	test('transcript tab lists cues and clicking one seeks the player', async ({ page }) => {
		await openEditor(page);

		await page.getByRole('tab', { name: /transcript/i }).click();
		const search = page.getByPlaceholder('Search transcript…');
		await expect(search).toBeVisible();

		// The seeded transcript has multiple cues; click the last one (starts > 0).
		const cueButtons = page.getByTestId('transcript-panel').locator('ul > li > button');
		const count = await cueButtons.count();
		expect(count).toBeGreaterThan(1);
		await cueButtons.nth(count - 1).click();

		// The playhead moved: the transport timecode no longer reads 0:00.0.
		await expect(page.getByTestId('transport-timecode')).not.toHaveText(/^0:00\.0/, {
			timeout: 10_000
		});
	});

	test('creates, renames, and deletes a moment', async ({ page }) => {
		await openEditor(page);
		const name = `e2e-moment-${Date.now()}`;

		await page.getByRole('button', { name: 'New moment' }).first().click();
		await expect(page.getByText('Moment created').first()).toBeVisible({ timeout: 10_000 });

		// Creating selects the moment and opens the edit form on the Moments tab.
		const form = page.getByTestId('moment-edit-form');
		await expect(form).toBeVisible();
		await form.locator('#moment-name').fill(name);
		await form.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(page.getByText('Moment saved').first()).toBeVisible({ timeout: 10_000 });

		// It shows up in the list and on the timeline track.
		await expect(page.getByTestId('moments-list').getByText(name).first()).toBeVisible();
		await expect(page.locator(`[data-timeline-bar]`, { hasText: name }).first()).toBeVisible();

		await deleteSelectedMoment(page);
		await expect(page.getByTestId('moments-list').getByText(name)).toHaveCount(0);
	});

	test('splits the selected moment at the playhead', async ({ page }) => {
		await openEditor(page);
		const name = `e2e-split-${Date.now()}`;

		// Create a moment at playhead 0 (default span 0–5s of the 6s file) and name it.
		await page.getByRole('button', { name: 'New moment' }).first().click();
		const form = page.getByTestId('moment-edit-form');
		await expect(form).toBeVisible();
		await form.locator('#moment-name').fill(name);
		await form.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(page.getByText('Moment saved').first()).toBeVisible({ timeout: 10_000 });

		// Seek to the middle of the timeline via the ruler, then split.
		const ruler = page.getByTestId('timeline-ruler');
		const box = await ruler.boundingBox();
		expect(box).toBeTruthy();
		await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.getByRole('button', { name: 'Split at playhead' }).click();
		await expect(page.getByText('Moment split').first()).toBeVisible({ timeout: 10_000 });

		// Both halves exist; the right-hand half got the (2) suffix and selection.
		const list = page.getByTestId('moments-list');
		await expect(list.getByText(`${name} (2)`).first()).toBeVisible();
		await expect(list.getByText(name).first()).toBeVisible();

		// Clean up both halves (the new right-hand half is already selected).
		await deleteSelectedMoment(page);
		await selectMomentCard(page, name);
		await deleteSelectedMoment(page);
		await expect(list.getByText(name)).toHaveCount(0);
	});

	test('keyboard help opens with ? and lists the new shortcut groups', async ({ page }) => {
		await openEditor(page);

		await page.keyboard.press('?');
		// Scope to the dialog — the sidebar nav also contains a "Timeline" label.
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('Keyboard shortcuts').first()).toBeVisible();
		for (const group of ['Playback', 'Moments', 'Timeline']) {
			await expect(dialog.getByText(group, { exact: true }).first()).toBeVisible();
		}
		await expect(dialog.getByText('Split selected moment at playhead')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('transport play button starts playback', async ({ page }) => {
		await openEditor(page);

		// The duration timecode appears before the Vidstack element finishes
		// mounting — wait for the real player so the click exercises live
		// playback rather than the queued-intent path.
		await expect(page.locator('media-player')).toBeAttached({ timeout: 15_000 });

		const play = page.getByRole('button', { name: 'Play', exact: true });
		await expect(play).toBeVisible();
		await play.click();
		// Once media actually plays the button flips to Pause.
		await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({
			timeout: 15_000
		});
	});
});
