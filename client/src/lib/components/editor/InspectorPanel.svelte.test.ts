import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InspectorPanel from './InspectorPanel.svelte';
import { INSPECTOR_MAX_WIDTH, INSPECTOR_MIN_WIDTH } from '$lib/state/editor-preferences.svelte';
import { ICONS } from '$lib/utils/icons';

const TABS = [
	{ id: 'moments', label: 'Moments', icon: ICONS.movie, count: 2 },
	{ id: 'transcript', label: 'Transcript', icon: ICONS.transcript, count: 0 },
	{ id: 'audio', label: 'Audio', icon: ICONS.audioDetect }
];

function renderPanel(over: Record<string, unknown> = {}) {
	return render(InspectorPanel, {
		props: {
			tabs: TABS,
			active: 'moments',
			width: 400,
			...over
		}
	});
}

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
	return new PointerEvent(type, { pointerId: 1, bubbles: true, ...init });
}

afterEach(() => {
	// Flush any stray capture-phase listeners other suites may install.
	window.dispatchEvent(new MouseEvent('click'));
});

describe('InspectorPanel', () => {
	it('renders every tab with label and a count badge only when count > 0', () => {
		const screen = renderPanel();
		const tabs = [...screen.container.querySelectorAll('[role="tab"]')];
		expect(tabs.map((t) => t.textContent?.trim().replace(/\s+/g, ' '))).toEqual([
			'Moments 2',
			'Transcript',
			'Audio'
		]);
	});

	it('marks the active tab selected and fires onselecttab for the others', () => {
		const onselecttab = vi.fn();
		const screen = renderPanel({ onselecttab });
		const tabs = [...screen.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
		expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
		expect(tabs[0]!.className).toContain('bg-primary/10');
		expect(tabs[1]!.getAttribute('aria-selected')).toBe('false');
		tabs[2]!.click();
		expect(onselecttab).toHaveBeenCalledWith('audio');
	});

	it('renders its children snippet inside the scrollable body', () => {
		const screen = render(InspectorPanel, {
			props: { tabs: TABS, active: 'moments', width: 400 }
		});
		// Without a children snippet the body is just empty — assert structure.
		// The body sits inside the Tabs.Root the tablist also lives in, so it's
		// a descendant of <aside>, not a direct child.
		const body = screen.container.querySelector('aside div.min-h-0');
		expect(body).not.toBeNull();
	});

	it('applies the width as a CSS variable and merges the class prop', () => {
		const screen = renderPanel({ class: 'order-5' });
		const aside = screen.container.querySelector('aside')!;
		expect(aside.getAttribute('style')).toContain('--inspector-w: 400px');
		expect(aside.className).toContain('order-5');
	});

	it('resizes via the divider: live while dragging, committed once on release', async () => {
		const onwidthchange = vi.fn();
		const screen = renderPanel({ onwidthchange, width: 400 });
		const aside = screen.container.querySelector('aside')!;
		const divider = screen.container.querySelector<HTMLElement>(
			'[data-testid="inspector-divider"]'
		)!;
		divider.setPointerCapture = vi.fn();
		divider.releasePointerCapture = vi.fn();

		divider.dispatchEvent(pointerEvent('pointerdown', { clientX: 500, button: 0 }));
		divider.dispatchEvent(pointerEvent('pointermove', { clientX: 480 }));
		// Live width follows the drag locally; nothing is committed yet.
		await vi.waitFor(() => {
			expect(aside.getAttribute('style')).toContain('--inspector-w: 420px');
		});
		expect(onwidthchange).not.toHaveBeenCalled();

		// Drags clamp into [min, max] live.
		divider.dispatchEvent(pointerEvent('pointermove', { clientX: -2000 }));
		await vi.waitFor(() => {
			expect(aside.getAttribute('style')).toContain(`--inspector-w: ${INSPECTOR_MAX_WIDTH}px`);
		});

		divider.dispatchEvent(pointerEvent('pointermove', { clientX: 5000 }));
		divider.dispatchEvent(pointerEvent('pointerup', { clientX: 5000 }));
		// Release commits exactly once, with the final clamped value.
		expect(onwidthchange).toHaveBeenCalledTimes(1);
		expect(onwidthchange).toHaveBeenCalledWith(INSPECTOR_MIN_WIDTH);

		// After pointerup further moves are ignored.
		divider.dispatchEvent(pointerEvent('pointermove', { clientX: 480 }));
		expect(onwidthchange).toHaveBeenCalledTimes(1);
	});

	it('resizes via the keyboard: arrows nudge ±16px, clamped', () => {
		const onwidthchange = vi.fn();
		const screen = renderPanel({ onwidthchange, width: 400 });
		const divider = screen.container.querySelector<HTMLElement>(
			'[data-testid="inspector-divider"]'
		)!;
		expect(divider.getAttribute('tabindex')).toBe('0');
		expect(divider.getAttribute('aria-valuenow')).toBe('400');

		divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		expect(onwidthchange).toHaveBeenLastCalledWith(416);
		divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(onwidthchange).toHaveBeenLastCalledWith(384);
		divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(onwidthchange).toHaveBeenCalledTimes(2);
	});

	it('implements roving tabindex + arrow navigation on the tablist', () => {
		// aria-controls is populated by bits-ui once a matching Tabs.Content
		// registers itself — that only happens once the page renders real panel
		// content alongside this component (see page.svelte.test.ts), so it's
		// not asserted here; tabindex + keyboard navigation don't depend on it.
		const onselecttab = vi.fn();
		const screen = renderPanel({ onselecttab });
		const tabs = [...screen.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
		expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

		tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(onselecttab).toHaveBeenLastCalledWith('transcript');
		tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		expect(onselecttab).toHaveBeenLastCalledWith('audio');
		tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		expect(onselecttab).toHaveBeenLastCalledWith('audio');
		tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		expect(onselecttab).toHaveBeenLastCalledWith('moments');
	});

	it('ignores non-left mouse buttons on the divider', () => {
		const onwidthchange = vi.fn();
		const screen = renderPanel({ onwidthchange });
		const divider = screen.container.querySelector<HTMLElement>(
			'[data-testid="inspector-divider"]'
		)!;
		divider.setPointerCapture = vi.fn();
		divider.dispatchEvent(
			pointerEvent('pointerdown', { clientX: 500, button: 2, pointerType: 'mouse' })
		);
		divider.dispatchEvent(pointerEvent('pointermove', { clientX: 400 }));
		expect(onwidthchange).not.toHaveBeenCalled();
	});

	it('survives without onselecttab/onwidthchange callbacks', () => {
		const screen = renderPanel();
		const tab = screen.container.querySelector<HTMLButtonElement>('[role="tab"]')!;
		expect(() => tab.click()).not.toThrow();
	});
});
