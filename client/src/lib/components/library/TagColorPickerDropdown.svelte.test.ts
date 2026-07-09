import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { userEvent } from '@vitest/browser/context';
import TagColorPickerDropdown from './TagColorPickerDropdown.svelte';

const palette = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'] as const;

function renderPicker(props: Record<string, unknown> = {}) {
	return render(TagColorPickerDropdown, {
		props: {
			open: false,
			color: '#FF0000',
			draft: '#FF0000',
			palette,
			keyId: 'tag-1',
			...props
		}
	});
}

// bits-ui's Popover.Content is portalled to `document.body`.
function panel() {
	return document.querySelector('[data-slot="popover-content"]');
}

describe('TagColorPickerDropdown', () => {
	it('renders a color swatch button reflecting the current color', () => {
		const screen = renderPicker();
		const swatch = screen.container.querySelector<HTMLElement>(
			'[data-color-dropdown] > button span'
		);
		expect(swatch).not.toBeNull();
		const bg = (swatch!.getAttribute('style') ?? '').toLowerCase();
		expect(bg).toMatch(/background-color:\s*(#ff0000|rgb\(255,\s*0,\s*0\))/);
	});

	it('keeps the popover closed when open is false', () => {
		renderPicker({ open: false });
		expect(panel()).toBeNull();
	});

	it('fires onOpenChange(true) on the swatch button click', async () => {
		const onOpenChange = vi.fn();
		const screen = renderPicker({ onOpenChange });
		const trigger = screen.getByTitle('Select tag color');
		await trigger.click();
		expect(onOpenChange).toHaveBeenCalledWith(true);

		// Close it back out (real click, same as bits-ui's own toggle) so the
		// popover's floating-layer effects (focus-scope, dismissible-layer,
		// escape-layer) are fully settled before the test ends — leaving it open
		// through teardown races bits-ui's internal RAF/debounced cleanup against
		// the component being destroyed.
		await trigger.click();
		await vi.waitFor(() => {
			expect(panel()).toBeNull();
		});
	});

	it('closes on Escape, fires onOpenChange(false), and returns focus to the trigger', async () => {
		const onOpenChange = vi.fn();
		const screen = renderPicker({ onOpenChange });
		const trigger = screen.getByTitle('Select tag color');
		// Open via a real (Playwright-driven) trigger click — rather than an
		// already-open initial render — so bits-ui's focus-scope actually
		// observes the trigger as focused and captures it as the "pre-focus"
		// element to restore to when the popover closes. A raw DOM `.click()`
		// call does not reliably transfer focus the way a real click does.
		await trigger.click();

		const content = panel();
		expect(content).not.toBeNull();
		content!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		await vi.waitFor(() => {
			expect(panel()).toBeNull();
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(trigger.element());
		});
	});

	it('closes and fires onOpenChange(false) on outside click', async () => {
		const onOpenChange = vi.fn();
		const screen = renderPicker({ onOpenChange, title: 'Outside-click swatch' });
		await screen.getByTitle('Outside-click swatch').click();
		expect(panel()).not.toBeNull();

		// A click on an unrelated element outside the trigger/content — bits-ui's
		// dismissible layer detects this via a real `pointerdown`, which a raw
		// DOM `.click()` call never dispatches, so drive it through
		// `userEvent.click` (real browser automation) instead.
		const outside = document.createElement('button');
		outside.textContent = 'outside';
		// Positioned well clear of the floating popover content (which anchors
		// near the trigger, close to the test viewport's origin) so Playwright's
		// real click can actually land on it instead of being intercepted by the
		// popover's own subtree.
		outside.style.cssText = 'position: fixed; bottom: 0; right: 0;';
		document.body.appendChild(outside);
		try {
			await userEvent.click(outside);
			await vi.waitFor(() => {
				expect(panel()).toBeNull();
			});
			expect(onOpenChange).toHaveBeenCalledWith(false);
		} finally {
			outside.remove();
		}
	});

	it('renders one palette button per color when open', async () => {
		renderPicker({ open: true });
		await tick();
		const buttons = panel()!.querySelectorAll('.grid button');
		expect(buttons).toHaveLength(palette.length);
	});

	it('fires onpick with the chosen color', async () => {
		const onpick = vi.fn();
		renderPicker({ open: true, onpick });
		await tick();
		const buttons = panel()!.querySelectorAll<HTMLButtonElement>('.grid button');
		buttons[1]!.click();
		expect(onpick).toHaveBeenCalledWith('#00FF00');
	});

	it('highlights the selected color in the palette', async () => {
		renderPicker({ open: true });
		await tick();
		const highlighted = Array.from(
			panel()!.querySelectorAll<HTMLButtonElement>('.grid button')
		).find((b) => b.classList.contains('ring-2'));
		expect(highlighted).toBeDefined();
		expect(highlighted!.getAttribute('title')).toBe('#FF0000');
	});

	it('renders the hex input field seeded from the draft', async () => {
		renderPicker({ open: true });
		await tick();
		const input = panel()!.querySelector<HTMLInputElement>('input');
		expect(input).not.toBeNull();
		expect(input!.value).toBe('#FF0000');
	});

	it('fires onupdateDraft with the typed value', async () => {
		const onupdateDraft = vi.fn();
		renderPicker({ open: true, onupdateDraft });
		await tick();
		const input = panel()!.querySelector<HTMLInputElement>('input')!;
		input.value = '#abcdef';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onupdateDraft).toHaveBeenCalledWith('#abcdef');
	});

	it('fires oncommitDraft on blur', async () => {
		const oncommitDraft = vi.fn();
		renderPicker({ open: true, oncommitDraft });
		await tick();
		const input = panel()!.querySelector<HTMLInputElement>('input')!;
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		expect(oncommitDraft).toHaveBeenCalledTimes(1);
	});

	it('fires oncommitDraft on Enter key', async () => {
		const oncommitDraft = vi.fn();
		renderPicker({ open: true, oncommitDraft });
		await tick();
		const input = panel()!.querySelector<HTMLInputElement>('input')!;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(oncommitDraft).toHaveBeenCalledTimes(1);
	});

	it('uses the custom title prop', () => {
		const screen = renderPicker({ title: 'Pick color' });
		const button = screen.container.querySelector('[data-color-dropdown] > button')!;
		expect(button.getAttribute('title')).toBe('Pick color');
	});

	it('falls back to the default title', () => {
		const screen = renderPicker();
		const button = screen.container.querySelector('[data-color-dropdown] > button')!;
		expect(button.getAttribute('title')).toBe('Select tag color');
	});
});
