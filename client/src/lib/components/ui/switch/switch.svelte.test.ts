import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
// Real compiled Tailwind so getComputedStyle sees actual colors — this test
// asserts RENDERED style, not class strings, because the bug it guards
// against (registry `data-checked:` variants vs bits-ui's actual
// `data-state="checked"` attribute) is invisible to class-name assertions.
import '../../../../app.css';
import { Switch } from './index.js';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function root(): HTMLElement {
	const el = document.querySelector<HTMLElement>('[data-slot="switch"]');
	if (!el) throw new Error('switch root not found');
	return el;
}

function thumb(): HTMLElement {
	const el = document.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
	if (!el) throw new Error('switch thumb not found');
	return el;
}

function thumbOffset(): number {
	return thumb().getBoundingClientRect().left - root().getBoundingClientRect().left;
}

afterEach(() => {
	document.documentElement.classList.remove('dark');
});

describe('Switch (vendored, state rendering)', () => {
	it('renders a visible track in the checked state (light)', async () => {
		render(Switch, { props: { checked: true } });
		await tick();
		expect(root().getAttribute('data-state')).toBe('checked');
		const bg = getComputedStyle(root()).backgroundColor;
		expect(bg).not.toBe(TRANSPARENT);
		expect(bg).not.toBe('transparent');
	});

	it('renders a visible track in the unchecked state (light)', async () => {
		render(Switch, { props: { checked: false } });
		await tick();
		expect(root().getAttribute('data-state')).toBe('unchecked');
		const bg = getComputedStyle(root()).backgroundColor;
		expect(bg).not.toBe(TRANSPARENT);
		expect(bg).not.toBe('transparent');
	});

	it('renders visibly distinct checked vs unchecked tracks', async () => {
		const checked = render(Switch, { props: { checked: true } });
		await tick();
		const checkedBg = getComputedStyle(root()).backgroundColor;
		checked.unmount();

		render(Switch, { props: { checked: false } });
		await tick();
		const uncheckedBg = getComputedStyle(root()).backgroundColor;
		expect(checkedBg).not.toBe(uncheckedBg);
	});

	it('renders a visible track in both states in dark mode', async () => {
		document.documentElement.classList.add('dark');
		const checked = render(Switch, { props: { checked: true } });
		await tick();
		expect(getComputedStyle(root()).backgroundColor).not.toBe(TRANSPARENT);
		checked.unmount();

		render(Switch, { props: { checked: false } });
		await tick();
		expect(getComputedStyle(root()).backgroundColor).not.toBe(TRANSPARENT);
	});

	it('translates the thumb when checked (thumb sits further right than unchecked)', async () => {
		const unchecked = render(Switch, { props: { checked: false } });
		await tick();
		const uncheckedOffset = thumbOffset();
		unchecked.unmount();

		render(Switch, { props: { checked: true } });
		await tick();
		const checkedOffset = thumbOffset();
		// default size: track w-[32px], thumb size-4 → checked translate ≈ 14px.
		expect(checkedOffset).toBeGreaterThan(uncheckedOffset + 8);
	});

	it('toggles data-state on click', async () => {
		render(Switch, { props: { checked: false } });
		await tick();
		expect(root().getAttribute('data-state')).toBe('unchecked');
		root().click();
		await tick();
		expect(root().getAttribute('data-state')).toBe('checked');
	});
});
