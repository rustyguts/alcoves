import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import EditorKeyboardHelpModal from './EditorKeyboardHelpModal.svelte';

// The Skeleton Dialog portals its content onto document.body and mounts on a
// MACROTASK, so query the document (not screen.container) and flush a real
// timeout before asserting.
const settle = async () => {
	await tick();
	await new Promise((r) => setTimeout(r, 50));
};

/** The currently visible dialog content, if any. */
function openDialog(): HTMLElement | null {
	return (
		[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
			(el) => el.getAttribute('data-state') === 'open' && !el.hasAttribute('hidden')
		) ?? null
	);
}

describe('EditorKeyboardHelpModal', () => {
	it('shows nothing visible while closed', async () => {
		render(EditorKeyboardHelpModal, { props: { open: false } });
		await settle();
		expect(openDialog()).toBeNull();
	});

	it('renders the three sections when open', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await settle();
		const content = openDialog();
		expect(content).not.toBeNull();
		const text = content?.textContent ?? '';
		expect(text).toContain('Keyboard shortcuts');
		expect(text).toContain('Playback');
		expect(text).toContain('Moments');
		expect(text).toContain('Timeline');
	});

	it('lists the new bindings with their descriptions', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await settle();
		const content = openDialog();
		const kbds = [...(content?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent?.trim());
		for (const key of ['Space', 'K', 'J', 'L', ',', '.', 'R', 'S', 'Del', 'F', 'G', 'Z', 'X']) {
			expect(kbds).toContain(key);
		}
		const text = content?.textContent ?? '';
		expect(text).toContain('Play / pause');
		expect(text).toContain('Jump back 5s');
		expect(text).toContain('Jump forward 5s');
		expect(text).toContain('Step back ~1 frame');
		expect(text).toContain('Step forward ~1 frame');
		expect(text).toContain('Loop the selected moment');
		expect(text).toContain('Split selected moment at playhead');
		expect(text).toContain('Delete selected moment');
		expect(text).toContain('Zoom to fit');
		expect(text).toContain('Toggle snapping');
	});

	it('closes via the close trigger (flips the bound open state)', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await settle();
		const closeBtn = openDialog()?.querySelector<HTMLButtonElement>('[aria-label="Close"]');
		expect(closeBtn).toBeTruthy();
		closeBtn!.click();
		await vi.waitFor(() => {
			expect(openDialog()).toBeNull();
		});
	});
});
