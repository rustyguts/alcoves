import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import EmojiPicker from './EmojiPicker.svelte';

const ROCKET = '\u{1F680}';
const SMILE = '\u{1F60A}';

describe('EmojiPicker', () => {
	it('displays the selected emoji', async () => {
		const screen = render(EmojiPicker, { props: { value: ROCKET } });
		expect(screen.container.textContent).toContain(ROCKET);
	});

	it('shows the icon placeholder when no emoji is selected', async () => {
		const screen = render(EmojiPicker, { props: { value: null } });
		// AppIcon renders an inline <svg> for the emoji glyph.
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('opens the picker on toggle click and closes on a second click', async () => {
		const screen = render(EmojiPicker, { props: { value: null } });
		const toggle = screen.container.querySelector<HTMLButtonElement>('button')!;

		expect(screen.container.querySelector('.absolute')).toBeNull();
		toggle.click();
		await tick();
		expect(screen.container.querySelector('.absolute')).not.toBeNull();
		toggle.click();
		await tick();
		expect(screen.container.querySelector('.absolute')).toBeNull();
	});

	it('fires onselect with the chosen emoji and closes the picker', async () => {
		const onselect = vi.fn();
		const screen = render(EmojiPicker, { props: { value: null, onselect } });
		screen.container.querySelector<HTMLButtonElement>('button')!.click();
		await tick();

		const emojiButtons = screen.container.querySelectorAll<HTMLButtonElement>('.grid button');
		expect(emojiButtons.length).toBeGreaterThan(0);
		emojiButtons[0]!.click();
		await tick();

		expect(onselect).toHaveBeenCalledTimes(1);
		expect(typeof onselect.mock.calls[0]![0]).toBe('string');
		expect(screen.container.querySelector('.absolute')).toBeNull();
	});

	it('shows a Remove button only when an emoji is selected', async () => {
		const withValue = render(EmojiPicker, { props: { value: SMILE } });
		withValue.container.querySelector<HTMLButtonElement>('button')!.click();
		await tick();
		const removeWith = [...withValue.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Remove')
		);
		expect(removeWith).toBeDefined();

		const withoutValue = render(EmojiPicker, { props: { value: null } });
		withoutValue.container.querySelector<HTMLButtonElement>('button')!.click();
		await tick();
		const removeWithout = [...withoutValue.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Remove')
		);
		expect(removeWithout).toBeUndefined();
	});

	it('fires onselect with null when Remove is clicked', async () => {
		const onselect = vi.fn();
		const screen = render(EmojiPicker, { props: { value: SMILE, onselect } });
		screen.container.querySelector<HTMLButtonElement>('button')!.click();
		await tick();

		const remove = [...screen.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
			b.textContent?.includes('Remove')
		)!;
		remove.click();
		await tick();

		expect(onselect).toHaveBeenCalledWith(null);
	});

	it('renders every category label', async () => {
		const screen = render(EmojiPicker, { props: { value: null } });
		screen.container.querySelector<HTMLButtonElement>('button')!.click();
		await tick();
		const text = screen.container.textContent ?? '';
		for (const label of ['Smileys', 'Nature', 'Animals', 'Food', 'Objects', 'Travel']) {
			expect(text).toContain(label);
		}
	});

	it('highlights the currently selected emoji in the grid', async () => {
		const screen = render(EmojiPicker, { props: { value: SMILE } });
		screen.container.querySelector<HTMLButtonElement>('button')!.click();
		await tick();
		const highlighted = [
			...screen.container.querySelectorAll<HTMLButtonElement>('.grid button')
		].find((b) => b.classList.contains('preset-tonal-primary'));
		expect(highlighted).toBeDefined();
		expect(highlighted?.textContent).toContain(SMILE);
	});

	it('exposes the toggle button title', async () => {
		const screen = render(EmojiPicker, { props: { value: null } });
		const toggle = screen.container.querySelector<HTMLButtonElement>('button')!;
		expect(toggle.getAttribute('title')).toBe('Choose emoji icon');
	});
});
