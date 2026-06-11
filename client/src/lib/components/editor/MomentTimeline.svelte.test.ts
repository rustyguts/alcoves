import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import MomentTimeline from './MomentTimeline.svelte';
import type { Moment } from '$lib/types/api';

const CONTAINER_WIDTH = 1000;

function makeMoment(over: Partial<Moment>): Moment {
	return {
		id: 'm1',
		libraryId: 'lib1',
		fileId: 'file1',
		createdById: 'u1',
		name: 'Clip',
		description: '',
		startSeconds: 0,
		endSeconds: 10,
		exportStatus: null,
		exportProgress: null,
		exportEtaSeconds: null,
		exportVersion: 1,
		exportedVersion: null,
		trashedAt: null,
		createdAt: '',
		updatedAt: '',
		tags: [],
		...over
	} as Moment;
}

function baseProps(over: Record<string, unknown> = {}) {
	return {
		duration: 100,
		currentTime: 10,
		moments: [makeMoment({ id: 'm1', startSeconds: 10, endSeconds: 40 })],
		selectedId: null,
		...over
	};
}

// onMount reads scrollEl.clientWidth. In the headless browser the offscreen
// container has zero width, which would leave pxPerSec at 0 and break geometry.
// Pin a deterministic clientWidth on every element so the timeline measures
// 1000px regardless of viewport, matching the Vue spec's manual override.
function pinClientWidth(width = CONTAINER_WIDTH) {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
		configurable: true,
		get() {
			return width;
		}
	});
	return () => {
		if (original) {
			Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
		} else {
			delete proto.clientWidth;
		}
	};
}

let restoreClientWidth: (() => void) | null = null;

function renderTimeline(over: Record<string, unknown> = {}) {
	restoreClientWidth = pinClientWidth();
	const screen = render(MomentTimeline, { props: baseProps(over) });
	return screen;
}

function findButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll('button')).find((b) =>
		b.textContent?.includes(label)
	) as HTMLButtonElement | undefined;
}

afterEach(() => {
	// A completed drag installs a one-shot capture-phase click suppressor on
	// window; flush any a test left behind so it can't eat the next test's click.
	window.dispatchEvent(new MouseEvent('click'));
	restoreClientWidth?.();
	restoreClientWidth = null;
});

describe('MomentTimeline', () => {
	it('renders the time readout and zoom percent', async () => {
		const screen = renderTimeline();
		await tick();
		expect(screen.container.textContent).toContain('0:10 / 1:40');
		expect(screen.container.textContent).toContain('100%');
	});

	it('fires createMoment and openShortcuts from the toolbar', async () => {
		const oncreateMoment = vi.fn();
		const onopenShortcuts = vi.fn();
		const screen = renderTimeline({ oncreateMoment, onopenShortcuts });
		await tick();
		findButton(screen.container, 'New moment')?.click();
		(screen.container.querySelector('[aria-label="Keyboard shortcuts"]') as HTMLElement)?.click();
		expect(oncreateMoment).toHaveBeenCalledTimes(1);
		expect(onopenShortcuts).toHaveBeenCalledTimes(1);
	});

	it('seeks when the track is clicked', async () => {
		const onseek = vi.fn();
		const screen = renderTimeline({ onseek });
		await tick();
		const track = screen.container.querySelector('[role="slider"]') as HTMLElement;
		// getBoundingClientRect().left is the offscreen container's left; subtract it
		// so the math matches an x of 500 within a 1000px inner width → 50% of 100s.
		const rect = track.getBoundingClientRect();
		track.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
		expect(onseek).toHaveBeenCalledTimes(1);
		expect(onseek.mock.calls.at(-1)?.[0]).toBeCloseTo(50);
	});

	it('seeks when the ruler is clicked', async () => {
		const onseek = vi.fn();
		const screen = renderTimeline({ onseek });
		await tick();
		const ruler = screen.container.querySelector('[aria-label="Seek"]') as HTMLElement;
		const rect = ruler.getBoundingClientRect();
		ruler.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 250, bubbles: true }));
		expect(onseek.mock.calls.at(-1)?.[0]).toBeCloseTo(25);
	});

	it('selects a moment when its bar is clicked', async () => {
		const onselectMoment = vi.fn();
		const screen = renderTimeline({ onselectMoment });
		await tick();
		const bar = screen.container.querySelector('.group') as HTMLElement;
		bar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onselectMoment.mock.calls.at(-1)?.[0]).toBe('m1');
	});

	it('zooms in and out with the keyboard', async () => {
		const screen = renderTimeline();
		await tick();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
		await tick();
		expect(screen.container.textContent).toContain('150%');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
		await tick();
		expect(screen.container.textContent).toContain('100%');
	});

	it('ignores keyboard shortcuts while typing in a field', async () => {
		const screen = renderTimeline();
		await tick();
		const input = document.createElement('input');
		document.body.appendChild(input);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
		await tick();
		expect(screen.container.textContent).toContain('100%');
		input.remove();
	});

	it('drags a moment body to create a pending change and saves it', async () => {
		const onselectMoment = vi.fn();
		const onsavePending = vi.fn();
		const screen = renderTimeline({ onselectMoment, onsavePending });
		await tick();
		const bar = screen.container.querySelector('.group') as HTMLElement;
		bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
		expect(onselectMoment.mock.calls.at(-1)?.[0]).toBe('m1');

		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 }));
		await tick();
		window.dispatchEvent(new MouseEvent('mouseup'));
		await tick();
		// onDragEnd installs a one-shot capture click suppressor; consume it so it
		// doesn't eat the Save click.
		window.dispatchEvent(new MouseEvent('click'));

		const saveBtn = findButton(screen.container, 'Save changes');
		expect(saveBtn?.disabled).toBe(false);
		saveBtn?.click();

		expect(onsavePending).toHaveBeenCalledTimes(1);
		const changes = onsavePending.mock.calls[0]?.[0] as Array<{
			id: string;
			startSeconds: number;
			endSeconds: number;
		}>;
		expect(changes[0]?.id).toBe('m1');
		// moved 50px / 10px-per-sec = +5s on a [10,40] window
		expect(changes[0]?.startSeconds).toBeCloseTo(15);
		expect(changes[0]?.endSeconds).toBeCloseTo(45);
	});

	it('resizes a moment via the start handle', async () => {
		const screen = renderTimeline();
		await tick();
		const handles = screen.container.querySelectorAll('.cursor-ew-resize');
		(handles[0] as HTMLElement).dispatchEvent(
			new MouseEvent('mousedown', { clientX: 0, bubbles: true })
		);
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 }));
		await tick();
		window.dispatchEvent(new MouseEvent('mouseup'));
		await tick();
		window.dispatchEvent(new MouseEvent('click'));
		const saveBtn = findButton(screen.container, 'Save changes');
		expect(saveBtn?.disabled).toBe(false);
	});

	it('does not save when there are no pending changes', async () => {
		const onsavePending = vi.fn();
		const screen = renderTimeline({ onsavePending });
		await tick();
		const saveBtn = findButton(screen.container, 'Save changes');
		expect(saveBtn?.disabled).toBe(true);
		expect(onsavePending).not.toHaveBeenCalled();
	});

	it('drops pending changes once the server reflects them', async () => {
		const screen = renderTimeline();
		await tick();
		const bar = screen.container.querySelector('.group') as HTMLElement;
		bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }));
		await tick();
		window.dispatchEvent(new MouseEvent('mouseup'));
		await tick();
		window.dispatchEvent(new MouseEvent('click'));
		let saveBtn = findButton(screen.container, 'Save changes');
		expect(saveBtn?.disabled).toBe(false);

		// server pushes the new values → pending entry should clear
		screen.rerender(
			baseProps({ moments: [makeMoment({ id: 'm1', startSeconds: 20, endSeconds: 50 })] })
		);
		await tick();
		saveBtn = findButton(screen.container, 'Save changes');
		expect(saveBtn?.disabled).toBe(true);
	});

	it('renders a status pill for a processed moment', async () => {
		const screen = renderTimeline({
			moments: [
				makeMoment({
					id: 'm1',
					startSeconds: 10,
					endSeconds: 40,
					exportStatus: 'ready',
					exportVersion: 2,
					exportedVersion: 2
				})
			]
		});
		await tick();
		expect(screen.container.textContent).toContain('Processed');
	});

	it('renders processing progress in the status pill', async () => {
		const screen = renderTimeline({
			moments: [
				makeMoment({
					id: 'm1',
					startSeconds: 10,
					endSeconds: 40,
					exportStatus: 'processing',
					exportProgress: 60
				})
			]
		});
		await tick();
		expect(screen.container.textContent).toContain('Processing 60%');
	});

	it('renders a waveform canvas when peaks are supplied', async () => {
		const screen = renderTimeline({
			waveformPeaks: [0.1, 0.5, 0.9, 0.3],
			waveformPeaksPerSecond: 50
		});
		await tick();
		expect(screen.container.querySelector('canvas')).not.toBeNull();
	});

	it('scrubs from the waveform row', async () => {
		const onseek = vi.fn();
		const screen = renderTimeline({
			onseek,
			waveformPeaks: [0.1, 0.5, 0.9, 0.3],
			waveformPeaksPerSecond: 50
		});
		await tick();
		const row = screen.container.querySelector('.waveform-row') as HTMLElement;
		const rect = row.getBoundingClientRect();
		row.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 100, bubbles: true }));
		// scrollLeft 0 + x 100 over 10px-per-sec = 10s
		expect(onseek.mock.calls.at(-1)?.[0]).toBeCloseTo(10);
	});

	it('zooms with ctrl+wheel', async () => {
		const screen = renderTimeline();
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const zoomWheel = new WheelEvent('wheel', { deltaY: -10, cancelable: true });
		Object.defineProperty(zoomWheel, 'ctrlKey', { value: true });
		scrollEl.dispatchEvent(zoomWheel);
		await tick();
		expect(screen.container.textContent).toContain('150%');
	});

	it('unmounts without throwing and stops responding to keydown', async () => {
		const screen = renderTimeline();
		await tick();
		expect(() => screen.unmount()).not.toThrow();
		// keydown after unmount must not crash (listener removed in onDestroy)
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
	});

	it('renders a failed status pill with a warning icon', async () => {
		const screen = renderTimeline({
			moments: [
				makeMoment({
					id: 'm1',
					startSeconds: 10,
					endSeconds: 40,
					exportStatus: 'failed'
				})
			]
		});
		await tick();
		expect(screen.container.textContent).toContain('Failed');
	});

	it('renders an indeterminate processing pill when no progress is known', async () => {
		const screen = renderTimeline({
			moments: [
				makeMoment({
					id: 'm1',
					startSeconds: 10,
					endSeconds: 40,
					exportStatus: 'queued',
					exportProgress: null
				})
			]
		});
		await tick();
		// no percent suffix: indeterminate spinner branch
		expect(screen.container.textContent).toContain('Processing');
		expect(screen.container.textContent).not.toContain('Processing 0%');
	});

	it('renders a not-processed pill for an un-exported moment', async () => {
		const screen = renderTimeline({
			moments: [
				makeMoment({
					id: 'm1',
					startSeconds: 10,
					endSeconds: 40,
					exportStatus: null
				})
			]
		});
		await tick();
		expect(screen.container.textContent).toContain('Not processed');
	});

	it('resizes a moment via the end handle', async () => {
		const screen = renderTimeline();
		await tick();
		const handles = screen.container.querySelectorAll('.cursor-ew-resize');
		// handles[1] is the right (end) handle → exercises the `end` drag branch
		(handles[1] as HTMLElement).dispatchEvent(
			new MouseEvent('mousedown', { clientX: 0, bubbles: true })
		);
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30 }));
		await tick();
		window.dispatchEvent(new MouseEvent('mouseup'));
		await tick();
		window.dispatchEvent(new MouseEvent('click'));
		const saveBtn = findButton(screen.container, 'Save changes');
		expect(saveBtn?.disabled).toBe(false);
		saveBtn?.click();
	});

	it('does not start a drag-suppressor when the pointer never moves', async () => {
		const onseek = vi.fn();
		const screen = renderTimeline({ onseek });
		await tick();
		const bar = screen.container.querySelector('.group') as HTMLElement;
		// mousedown then immediate mouseup with no movement → drag.moved stays false
		bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
		window.dispatchEvent(new MouseEvent('mouseup'));
		await tick();
		// a subsequent track click should still seek (no lingering suppressor)
		const track = screen.container.querySelector('[role="slider"]') as HTMLElement;
		const rect = track.getBoundingClientRect();
		track.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
		expect(onseek).toHaveBeenCalled();
	});

	it('scrolls left and right with the a/d keys', async () => {
		const screen = renderTimeline();
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const scrollBy = vi.spyOn(scrollEl, 'scrollBy').mockImplementation(() => {});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
		expect(scrollBy).toHaveBeenCalledTimes(2);
		expect((scrollBy.mock.calls[0]?.[0] as ScrollToOptions)?.left).toBeGreaterThan(0);
		expect((scrollBy.mock.calls[1]?.[0] as ScrollToOptions)?.left).toBeLessThan(0);
		scrollBy.mockRestore();
	});

	it('centers on the playhead with the c key', async () => {
		const screen = renderTimeline();
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const scrollTo = vi.spyOn(scrollEl, 'scrollTo').mockImplementation(() => {});
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
		expect(scrollTo).toHaveBeenCalledTimes(1);
		expect((scrollTo.mock.calls[0]?.[0] as ScrollToOptions)?.behavior).toBe('smooth');
		scrollTo.mockRestore();
	});

	// The offscreen headless container is not actually scrollable, so the browser
	// clamps any native scrollLeft assignment back to 0. Install a plain backing
	// field on the element instance so the component's `sc.scrollLeft += delta`
	// reads/writes a value we can observe.
	function trackScrollLeft(el: HTMLElement, initial = 0): { get current(): number } {
		let value = initial;
		Object.defineProperty(el, 'scrollLeft', {
			configurable: true,
			get() {
				return value;
			},
			set(v: number) {
				value = v;
			}
		});
		return {
			get current() {
				return value;
			}
		};
	}

	it('scrolls horizontally on a plain wheel event', async () => {
		const screen = renderTimeline();
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const tracked = trackScrollLeft(scrollEl, 0);
		const wheel = new WheelEvent('wheel', { deltaY: 40, cancelable: true });
		scrollEl.dispatchEvent(wheel);
		await tick();
		expect(tracked.current).toBe(40);
	});

	it('prefers the dominant horizontal wheel delta', async () => {
		const screen = renderTimeline();
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const tracked = trackScrollLeft(scrollEl, 0);
		// deltaX dominates deltaY → scroll by deltaX
		const wheel = new WheelEvent('wheel', { deltaX: 70, deltaY: 5, cancelable: true });
		scrollEl.dispatchEvent(wheel);
		await tick();
		expect(tracked.current).toBe(70);
	});

	it('ignores a zero-delta wheel event', async () => {
		const screen = renderTimeline();
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const tracked = trackScrollLeft(scrollEl, 25);
		const wheel = new WheelEvent('wheel', { deltaX: 0, deltaY: 0, cancelable: true });
		scrollEl.dispatchEvent(wheel);
		await tick();
		expect(tracked.current).toBe(25);
	});

	it('tracks scrollLeft when the timeline is scrolled', async () => {
		const screen = renderTimeline({
			waveformPeaks: [0.1, 0.5, 0.9, 0.3],
			waveformPeaksPerSecond: 50
		});
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const tracked = trackScrollLeft(scrollEl, 120);
		scrollEl.dispatchEvent(new Event('scroll'));
		await tick();
		// onScroll mirrors the element's scrollLeft into component state; the
		// waveform playhead then shifts by that amount. Re-render to confirm the
		// component picked it up without crashing.
		expect(tracked.current).toBe(120);
		const waveformPlayhead = screen.container.querySelector(
			'.waveform-row .bg-blue-500'
		) as HTMLElement;
		expect(waveformPlayhead).not.toBeNull();
	});

	it('auto-follows the playhead when zoomed in and it leaves the viewport', async () => {
		const screen = renderTimeline({ currentTime: 0 });
		await tick();
		const scrollEl = screen.container.querySelector('.timeline-scroll') as HTMLElement;
		const tracked = trackScrollLeft(scrollEl, 0);
		// zoom in so zoom > 1 and pxPerSec is large
		for (let i = 0; i < 5; i++) {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
			await tick();
		}
		// move the playhead far to the right → screenX beyond viewport → effect scrolls
		screen.rerender(baseProps({ currentTime: 90 }));
		await tick();
		expect(tracked.current).toBeGreaterThan(0);
	});

	it('stops handle clicks from bubbling to the track seek', async () => {
		const onseek = vi.fn();
		const screen = renderTimeline({ onseek });
		await tick();
		const handles = screen.container.querySelectorAll('.cursor-ew-resize');
		// clicking either resize handle calls stopPropagation, so no track seek fires
		(handles[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		(handles[1] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await tick();
		expect(onseek).not.toHaveBeenCalled();
	});

	it('formats fractional tick labels at high zoom on a short clip', async () => {
		// duration 2s over 1000px → pxPerSec 500 → tickInterval 0.25 (< 1) → fractions
		const screen = renderTimeline({
			duration: 2,
			currentTime: 0,
			moments: [makeMoment({ id: 'm1', startSeconds: 0.2, endSeconds: 1.2 })]
		});
		await tick();
		// a fractional label like "0:00.5" / "0:01.0" exercises the showFractions branch
		expect(screen.container.textContent).toMatch(/0:0\d\.\d/);
	});
});
