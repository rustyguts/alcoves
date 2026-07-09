import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import EditorKeyboardHelpModal from './EditorKeyboardHelpModal.svelte';

// bits-ui's Dialog.Content is portalled to `document.body` (and unmounted
// entirely while closed), so assertions query the document rather than
// screen.container — see AppModal.svelte.test.ts for the idiom.
function content() {
	return document.querySelector('[data-slot="dialog-content"]');
}

describe('EditorKeyboardHelpModal', () => {
	it('shows nothing visible while closed', async () => {
		render(EditorKeyboardHelpModal, { props: { open: false } });
		await tick();
		expect(content()).toBeNull();
	});

	it('renders the three sections when open', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await tick();
		const el = content();
		expect(el).not.toBeNull();
		const text = el?.textContent ?? '';
		expect(text).toContain('Keyboard shortcuts');
		expect(text).toContain('Playback');
		expect(text).toContain('Moments');
		expect(text).toContain('Timeline');
	});

	it('lists the new bindings with their descriptions', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await tick();
		const el = content();
		const kbds = [...(el?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent?.trim());
		for (const key of ['Space', 'K', 'J', 'L', ',', '.', 'R', 'S', 'Del', 'F', 'G', 'Z', 'X']) {
			expect(kbds).toContain(key);
		}
		const text = el?.textContent ?? '';
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
		await tick();
		const closeBtn = content()?.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
		expect(closeBtn).toBeTruthy();
		closeBtn!.click();
		await vi.waitFor(() => {
			expect(content()).toBeNull();
		});
	});
});
