import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import EditorKeyboardHelpModal from './EditorKeyboardHelpModal.svelte';

// The Skeleton Dialog portals its content onto document.body and keeps it
// mounted while toggling a `data-state`/`hidden` attribute, so query the
// document and read the dialog state rather than relying on text presence.
// The portal mounts asynchronously, so give it a frame to settle first.
const settle = async () => {
	await tick();
	await new Promise((r) => setTimeout(r, 50));
};

// The most-recently-rendered dialog content (last in document order).
function dialogContent(): HTMLElement | null {
	const els = document.querySelectorAll<HTMLElement>('[role="dialog"]');
	return els.length ? els[els.length - 1] : null;
}

describe('EditorKeyboardHelpModal', () => {
	it('renders the shortcut sections when open', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await settle();
		const content = dialogContent();
		expect(content?.getAttribute('data-state')).toBe('open');
		const text = content?.textContent ?? '';
		expect(text).toContain('Keyboard shortcuts');
		expect(text).toContain('Timeline');
		expect(text).toContain('Moments');
		expect(text).toContain('Playback');
		expect(text).toContain('Zoom in');
		expect(text).toContain('New moment at playhead');
		expect(text).toContain('Play / pause');
	});

	it('keeps the dialog content hidden when closed', async () => {
		render(EditorKeyboardHelpModal, { props: { open: false } });
		await settle();
		const content = dialogContent();
		expect(content?.getAttribute('data-state')).toBe('closed');
		expect(content?.hasAttribute('hidden')).toBe(true);
	});

	it('renders the key caps for a shortcut', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await settle();
		const kbds = Array.from(dialogContent()?.querySelectorAll('kbd') ?? []).map((k) =>
			k.textContent?.trim()
		);
		expect(kbds).toContain('Z');
		expect(kbds).toContain('Space');
	});

	it('renders a close trigger', async () => {
		render(EditorKeyboardHelpModal, { props: { open: true } });
		await settle();
		const closeBtn = dialogContent()?.querySelector('[aria-label="Close"]');
		expect(closeBtn).not.toBeNull();
	});
});
