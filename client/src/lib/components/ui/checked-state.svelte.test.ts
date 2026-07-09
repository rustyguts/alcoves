import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
// Real compiled Tailwind so getComputedStyle sees actual colors — these tests
// assert RENDERED style, not class strings, because the bug they guard
// against (registry `data-checked:`/`has-data-checked:` variants vs bits-ui
// 2.18.x's actual `data-state="checked"` attribute) is invisible to
// class-name assertions. Companion to ui/switch/switch.svelte.test.ts.
import '../../../app.css';
import CheckedStateHarness from './CheckedStateHarness.svelte';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function within(testId: string, selector: string): HTMLElement {
	const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"] ${selector}`);
	if (!el) throw new Error(`${selector} not found in [data-testid="${testId}"]`);
	return el;
}

afterEach(() => {
	document.documentElement.classList.remove('dark');
});

describe('checked-state rendering (vendored checkbox / radio / field-label)', () => {
	it('fills a checked checkbox and leaves distinct unchecked styling (light)', async () => {
		render(CheckedStateHarness);
		await tick();
		const checked = within('checkbox-checked', '[data-slot="checkbox"]');
		const unchecked = within('checkbox-unchecked', '[data-slot="checkbox"]');
		expect(checked.getAttribute('data-state')).toBe('checked');
		expect(unchecked.getAttribute('data-state')).toBe('unchecked');
		const checkedStyle = getComputedStyle(checked);
		expect(checkedStyle.backgroundColor).not.toBe(TRANSPARENT);
		expect(checkedStyle.backgroundColor).not.toBe(getComputedStyle(unchecked).backgroundColor);
		expect(checkedStyle.borderTopColor).not.toBe(getComputedStyle(unchecked).borderTopColor);
	});

	it('fills a checked checkbox in dark mode', async () => {
		document.documentElement.classList.add('dark');
		render(CheckedStateHarness);
		await tick();
		const checked = within('checkbox-checked', '[data-slot="checkbox"]');
		expect(getComputedStyle(checked).backgroundColor).not.toBe(TRANSPARENT);
	});

	it('fills the selected radio and gives its indicator dot contrast (light)', async () => {
		render(CheckedStateHarness);
		await tick();
		const checked = within('radio-checked', '[data-slot="radio-group-item"]');
		const unchecked = within('radio-unchecked', '[data-slot="radio-group-item"]');
		expect(checked.getAttribute('data-state')).toBe('checked');
		expect(unchecked.getAttribute('data-state')).toBe('unchecked');
		const trackBg = getComputedStyle(checked).backgroundColor;
		expect(trackBg).not.toBe(TRANSPARENT);
		expect(trackBg).not.toBe(getComputedStyle(unchecked).backgroundColor);
		// The indicator dot (`bg-primary-foreground`) must differ from the
		// filled track — with the pre-fix dead variants the track was
		// transparent and the white dot was invisible on the white page.
		const dot = within('radio-checked', '[data-slot="radio-group-indicator"] svg');
		expect(getComputedStyle(dot).backgroundColor).not.toBe(trackBg);
	});

	it('fills the selected radio in dark mode', async () => {
		document.documentElement.classList.add('dark');
		render(CheckedStateHarness);
		await tick();
		const checked = within('radio-checked', '[data-slot="radio-group-item"]');
		expect(getComputedStyle(checked).backgroundColor).not.toBe(TRANSPARENT);
	});

	it('highlights a field-label whose control is checked (choice-card treatment)', async () => {
		render(CheckedStateHarness);
		await tick();
		const checkedLabel = within('field-label-checked', '[data-slot="field-label"]');
		const uncheckedLabel = within('field-label-unchecked', '[data-slot="field-label"]');
		// `has-data-[state=checked]:bg-primary/5` — a real (if subtle) tint that
		// the unchecked sibling must not have.
		expect(getComputedStyle(checkedLabel).backgroundColor).not.toBe(TRANSPARENT);
		expect(getComputedStyle(checkedLabel).backgroundColor).not.toBe(
			getComputedStyle(uncheckedLabel).backgroundColor
		);
		expect(getComputedStyle(uncheckedLabel).backgroundColor).toBe(TRANSPARENT);
	});

	it('toggles checkbox data-state on click', async () => {
		render(CheckedStateHarness);
		await tick();
		const unchecked = within('checkbox-unchecked', '[data-slot="checkbox"]');
		unchecked.click();
		await tick();
		expect(unchecked.getAttribute('data-state')).toBe('checked');
	});

	it('moves radio selection on click', async () => {
		render(CheckedStateHarness);
		await tick();
		const b = within('radio-unchecked', '[data-slot="radio-group-item"]');
		b.click();
		await tick();
		expect(b.getAttribute('data-state')).toBe('checked');
		const a = within('radio-checked', '[data-slot="radio-group-item"]');
		expect(a.getAttribute('data-state')).toBe('unchecked');
	});

	// Dead-variant sweep (data-active/data-open/data-horizontal → data-[state=…]/
	// data-[orientation=…]): the same computed-style net for the other primitives
	// whose registry classes targeted attributes bits-ui 2.18.x never emits.
	it('renders the active tab visually distinct from inactive tabs', async () => {
		render(CheckedStateHarness);
		await tick();
		const triggers = document.querySelectorAll<HTMLElement>(
			'[data-testid="tabs"] [data-slot="tabs-trigger"]'
		);
		expect(triggers.length).toBe(2);
		const [active, inactive] = [...triggers];
		expect(active.getAttribute('data-state')).toBe('active');
		expect(inactive.getAttribute('data-state')).toBe('inactive');
		// `data-[state=active]:bg-background` — with the dead `data-active:`
		// variant both triggers rendered identically.
		const activeBg = getComputedStyle(active).backgroundColor;
		expect(activeBg).not.toBe(TRANSPARENT);
		expect(activeBg).not.toBe(getComputedStyle(inactive).backgroundColor);
	});

	it('gives the horizontal slider track a nonzero height', async () => {
		render(CheckedStateHarness);
		await tick();
		const track = within('slider', '[data-slot="slider-track"]');
		// `data-[orientation=horizontal]:h-1.5` = 6px — with the dead
		// `data-horizontal:` variant the track collapsed to zero height.
		expect(track.getBoundingClientRect().height).toBeGreaterThan(0);
		const range = within('slider', '[data-slot="slider-range"]');
		expect(range.getBoundingClientRect().height).toBeGreaterThan(0);
	});

	it('gives the vertical scroll-area scrollbar a nonzero width', async () => {
		render(CheckedStateHarness);
		await tick();
		const bar = within('scroll-area', '[data-slot="scroll-area-scrollbar"]');
		expect(bar.getAttribute('data-orientation')).toBe('vertical');
		// `data-[orientation=vertical]:w-2.5` = 10px — with the dead
		// `data-vertical:` variant the scrollbar had no width at all.
		expect(bar.getBoundingClientRect().width).toBeGreaterThan(0);
	});

	it('resolves an entry animation on an open dialog (overlay animations live)', async () => {
		render(CheckedStateHarness);
		await tick();
		// Dialog.Content portals to document.body. `data-[state=open]:animate-in`
		// must resolve to a real animation — with the dead `data-open:` variant
		// computed animation-name stayed 'none' and overlays popped unanimated.
		const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
		if (!content) throw new Error('dialog content not found');
		expect(content.getAttribute('data-state')).toBe('open');
		expect(getComputedStyle(content).animationName).not.toBe('none');
	});
});
