import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import TimelineRuler from './TimelineRuler.svelte';

// duration 60s at 10px/s → NICE_STEPS picks a 10s major interval (2s minors),
// so labels land at 0:00, 0:10, …, 1:00 at left = seconds * 10px.
function baseProps(over: Record<string, unknown> = {}) {
	return { duration: 60, pxPerSec: 10, playheadLeftPx: 100, ...over };
}

function getRuler(container: ParentNode): HTMLElement {
	const el = container.querySelector('[data-testid="timeline-ruler"]') as HTMLElement;
	// Synthetic pointerIds make the real capture APIs throw in chromium.
	el.setPointerCapture = vi.fn();
	el.releasePointerCapture = vi.fn();
	// Deterministic geometry — the offscreen container's left offset varies.
	el.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 20);
	return el;
}

function pointer(el: HTMLElement, type: string, init: PointerEventInit = {}) {
	el.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, button: 0, ...init }));
}

afterEach(() => {
	// Flush any one-shot capture-phase click suppressor a drag may leave on window.
	window.dispatchEvent(new MouseEvent('click'));
});

describe('TimelineRuler', () => {
	it('renders major tick labels from the NICE_STEPS ladder', async () => {
		const screen = render(TimelineRuler, { props: baseProps() });
		await tick();
		await expect.element(screen.getByText('0:00')).toBeInTheDocument();
		await expect.element(screen.getByText('0:30')).toBeInTheDocument();
		await expect.element(screen.getByText('1:00')).toBeInTheDocument();
		// 7 major labels (0..60 every 10s); minor ticks render unlabeled.
		expect(screen.container.querySelectorAll('span')).toHaveLength(7);
	});

	it('positions labels at seconds * pxPerSec', async () => {
		const screen = render(TimelineRuler, { props: baseProps() });
		await tick();
		const label = Array.from(screen.container.querySelectorAll('span')).find(
			(s) => s.textContent?.trim() === '0:10'
		);
		expect(label?.parentElement?.style.left).toBe('100px');
	});

	it('uses hour formatting once duration reaches an hour', async () => {
		const screen = render(TimelineRuler, { props: baseProps({ duration: 7200, pxPerSec: 0.1 }) });
		await tick();
		await expect.element(screen.getByText('0:00:00')).toBeInTheDocument();
		await expect.element(screen.getByText('1:30:00')).toBeInTheDocument();
	});

	it('renders no tick labels and refuses to seek when pxPerSec is 0', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(TimelineRuler, {
			props: baseProps({ pxPerSec: 0, onseek, onscrubchange })
		});
		await tick();
		expect(screen.container.querySelectorAll('span')).toHaveLength(0);
		const ruler = getRuler(screen.container);
		pointer(ruler, 'pointerdown', { clientX: 100 });
		expect(onseek).not.toHaveBeenCalled();
		// The scrub itself still arms; only the seek math is guarded.
		expect(onscrubchange).toHaveBeenCalledWith(true);
	});

	it('updates tick positions and the playhead on rerender', async () => {
		const screen = render(TimelineRuler, { props: baseProps() });
		await tick();
		await screen.rerender(baseProps({ pxPerSec: 20, playheadLeftPx: 250 }));
		await tick();
		// 20px/s drops the major interval to 5s; the reused 0:10 tick moves to 200px.
		const label = Array.from(screen.container.querySelectorAll('span')).find(
			(s) => s.textContent?.trim() === '0:10'
		);
		expect(label?.parentElement?.style.left).toBe('200px');
		const playhead = screen.container.querySelector('.bg-blue-500') as HTMLElement;
		expect(playhead.style.left).toBe('250px');
	});

	it('positions the playhead at playheadLeftPx', async () => {
		const screen = render(TimelineRuler, { props: baseProps({ playheadLeftPx: 137 }) });
		await tick();
		const playhead = screen.container.querySelector('.bg-blue-500') as HTMLElement;
		expect(playhead.style.left).toBe('137px');
	});

	it('seeks on left pointerdown, captures the pointer and reports scrub start', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(TimelineRuler, { props: baseProps({ onseek, onscrubchange }) });
		await tick();
		const ruler = getRuler(screen.container);
		const setCapture = vi.fn();
		ruler.setPointerCapture = setCapture;
		pointer(ruler, 'pointerdown', { clientX: 250, pointerType: 'mouse', button: 0 });
		expect(onseek).toHaveBeenCalledWith(25);
		expect(onscrubchange).toHaveBeenCalledWith(true);
		expect(setCapture).toHaveBeenCalledWith(1);
	});

	it('clamps seeks into [0, duration]', async () => {
		const onseek = vi.fn();
		const screen = render(TimelineRuler, { props: baseProps({ onseek }) });
		await tick();
		const ruler = getRuler(screen.container);
		pointer(ruler, 'pointerdown', { clientX: 5000 });
		pointer(ruler, 'pointermove', { clientX: -40 });
		expect(onseek.mock.calls.map((c) => c[0])).toEqual([60, 0]);
	});

	it('scrubs on pointermove and stops seeking after pointerup', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(TimelineRuler, { props: baseProps({ onseek, onscrubchange }) });
		await tick();
		const ruler = getRuler(screen.container);
		pointer(ruler, 'pointerdown', { clientX: 100 });
		pointer(ruler, 'pointermove', { clientX: 200 });
		pointer(ruler, 'pointerup');
		pointer(ruler, 'pointermove', { clientX: 300 });
		expect(onseek.mock.calls.map((c) => c[0])).toEqual([10, 20]);
		expect(onscrubchange.mock.calls.map((c) => c[0])).toEqual([true, false]);
	});

	it('ends the scrub on pointercancel', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(TimelineRuler, { props: baseProps({ onseek, onscrubchange }) });
		await tick();
		const ruler = getRuler(screen.container);
		pointer(ruler, 'pointerdown', { clientX: 100 });
		pointer(ruler, 'pointercancel');
		pointer(ruler, 'pointermove', { clientX: 300 });
		expect(onseek).toHaveBeenCalledTimes(1);
		expect(onscrubchange.mock.calls.map((c) => c[0])).toEqual([true, false]);
	});

	it('ignores non-left mouse buttons', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(TimelineRuler, { props: baseProps({ onseek, onscrubchange }) });
		await tick();
		const ruler = getRuler(screen.container);
		pointer(ruler, 'pointerdown', { clientX: 100, pointerType: 'mouse', button: 2 });
		pointer(ruler, 'pointermove', { clientX: 200 });
		expect(onseek).not.toHaveBeenCalled();
		expect(onscrubchange).not.toHaveBeenCalled();
	});

	it('does not report scrub end for a pointerup without an active scrub', async () => {
		const onscrubchange = vi.fn();
		const screen = render(TimelineRuler, { props: baseProps({ onscrubchange }) });
		await tick();
		const ruler = getRuler(screen.container);
		pointer(ruler, 'pointerup');
		expect(onscrubchange).not.toHaveBeenCalled();
	});

	it('does not seek when duration is 0', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(TimelineRuler, {
			props: baseProps({ duration: 0, onseek, onscrubchange })
		});
		await tick();
		const ruler = getRuler(screen.container);
		pointer(ruler, 'pointerdown', { clientX: 100 });
		expect(onseek).not.toHaveBeenCalled();
		expect(onscrubchange).toHaveBeenCalledWith(true);
	});

	it('survives a full scrub without onseek/onscrubchange callbacks', async () => {
		const screen = render(TimelineRuler, { props: baseProps() });
		await tick();
		const ruler = getRuler(screen.container);
		expect(() => {
			pointer(ruler, 'pointerdown', { clientX: 100 });
			pointer(ruler, 'pointermove', { clientX: 200 });
			pointer(ruler, 'pointerup');
		}).not.toThrow();
	});
});
