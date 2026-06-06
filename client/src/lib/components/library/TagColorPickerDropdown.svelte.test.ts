import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
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
		const screen = renderPicker({ open: false });
		expect(screen.container.querySelector('.grid')).toBeNull();
		expect(screen.container.querySelector('input')).toBeNull();
	});

	it('fires ontoggle on the swatch button click', async () => {
		const ontoggle = vi.fn();
		const screen = renderPicker({ ontoggle });
		const button = screen.container.querySelector<HTMLButtonElement>(
			'[data-color-dropdown] > button'
		)!;
		button.click();
		expect(ontoggle).toHaveBeenCalledTimes(1);
	});

	it('renders one palette button per color when open', () => {
		const screen = renderPicker({ open: true });
		const buttons = screen.container.querySelectorAll('.grid button');
		expect(buttons).toHaveLength(palette.length);
	});

	it('fires onpick with the chosen color', async () => {
		const onpick = vi.fn();
		const screen = renderPicker({ open: true, onpick });
		const buttons = screen.container.querySelectorAll<HTMLButtonElement>('.grid button');
		buttons[1]!.click();
		expect(onpick).toHaveBeenCalledWith('#00FF00');
	});

	it('highlights the selected color in the palette', () => {
		const screen = renderPicker({ open: true });
		const highlighted = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('.grid button')
		).find((b) => b.classList.contains('ring-2'));
		expect(highlighted).toBeDefined();
		expect(highlighted!.getAttribute('title')).toBe('#FF0000');
	});

	it('renders the hex input field seeded from the draft', () => {
		const screen = renderPicker({ open: true });
		const input = screen.container.querySelector<HTMLInputElement>('input');
		expect(input).not.toBeNull();
		expect(input!.value).toBe('#FF0000');
	});

	it('fires onupdateDraft with the typed value', async () => {
		const onupdateDraft = vi.fn();
		const screen = renderPicker({ open: true, onupdateDraft });
		const input = screen.container.querySelector<HTMLInputElement>('input')!;
		input.value = '#abcdef';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onupdateDraft).toHaveBeenCalledWith('#abcdef');
	});

	it('fires oncommitDraft on blur', async () => {
		const oncommitDraft = vi.fn();
		const screen = renderPicker({ open: true, oncommitDraft });
		const input = screen.container.querySelector<HTMLInputElement>('input')!;
		input.dispatchEvent(new Event('blur', { bubbles: true }));
		expect(oncommitDraft).toHaveBeenCalledTimes(1);
	});

	it('fires oncommitDraft on Enter key', async () => {
		const oncommitDraft = vi.fn();
		const screen = renderPicker({ open: true, oncommitDraft });
		const input = screen.container.querySelector<HTMLInputElement>('input')!;
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
