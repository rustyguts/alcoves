import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import WaveformTrack from './WaveformTrack.svelte';

function baseProps(over: Record<string, unknown> = {}) {
	return {
		peaks: Array.from({ length: 300 }, (_, i) => ((i % 10) + 1) / 10),
		peaksPerSecond: 50,
		duration: 60,
		pxPerSec: 10,
		scrollLeft: 0,
		viewportWidth: 640,
		playheadLeftPx: 100,
		...over
	};
}

function getTrack(container: ParentNode): HTMLElement {
	const el = container.querySelector('[data-testid="waveform-track"]') as HTMLElement;
	// Synthetic pointerIds make the real capture APIs throw in chromium.
	el.setPointerCapture = vi.fn();
	el.releasePointerCapture = vi.fn();
	// Deterministic geometry — the offscreen container's left offset varies.
	el.getBoundingClientRect = () => new DOMRect(0, 0, 640, 56);
	return el;
}

function pointer(el: HTMLElement, type: string, init: PointerEventInit = {}) {
	el.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, button: 0, ...init }));
}

afterEach(() => {
	vi.restoreAllMocks();
	// Flush any one-shot capture-phase click suppressor a drag may leave on window.
	window.dispatchEvent(new MouseEvent('click'));
});

describe('WaveformTrack', () => {
	it('renders a viewport-sized canvas, paints it and shows the Audio chip', async () => {
		const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
		const screen = render(WaveformTrack, { props: baseProps() });
		await tick();
		const canvas = screen.container.querySelector('canvas') as HTMLCanvasElement;
		expect(canvas).not.toBeNull();
		const dpr = window.devicePixelRatio || 1;
		expect(canvas.width).toBe(640 * dpr);
		expect(canvas.height).toBe(56 * dpr);
		expect(canvas.style.width).toBe('640px');
		expect(canvas.style.height).toBe('56px');
		expect(getContext).toHaveBeenCalledWith('2d');
		await expect.element(screen.getByText('Audio')).toBeInTheDocument();
	});

	it('sizes the scrub row to viewportWidth × 56', async () => {
		const screen = render(WaveformTrack, { props: baseProps({ viewportWidth: 500 }) });
		await tick();
		const row = screen.container.querySelector('[data-testid="waveform-track"]') as HTMLElement;
		expect(row.style.width).toBe('500px');
		expect(row.style.height).toBe('56px');
	});

	it('pins the playhead at playheadLeftPx minus scrollLeft', async () => {
		const screen = render(WaveformTrack, {
			props: baseProps({ playheadLeftPx: 500, scrollLeft: 120 })
		});
		await tick();
		const playhead = screen.container.querySelector('.bg-blue-500') as HTMLElement;
		expect(playhead.style.left).toBe('380px');
	});

	it('moves the playhead when scrollLeft changes', async () => {
		const screen = render(WaveformTrack, {
			props: baseProps({ playheadLeftPx: 500, scrollLeft: 0 })
		});
		await tick();
		await screen.rerender(baseProps({ playheadLeftPx: 500, scrollLeft: 200 }));
		await tick();
		const playhead = screen.container.querySelector('.bg-blue-500') as HTMLElement;
		expect(playhead.style.left).toBe('300px');
	});

	it('resizes the row and canvas when viewportWidth changes', async () => {
		const screen = render(WaveformTrack, { props: baseProps() });
		await tick();
		await screen.rerender(baseProps({ viewportWidth: 800 }));
		await tick();
		const row = screen.container.querySelector('[data-testid="waveform-track"]') as HTMLElement;
		expect(row.style.width).toBe('800px');
		const canvas = screen.container.querySelector('canvas') as HTMLCanvasElement;
		expect(canvas.style.width).toBe('800px');
		const dpr = window.devicePixelRatio || 1;
		expect(canvas.width).toBe(800 * dpr);
	});

	it('adds scrollLeft back when converting pointer x to seconds', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(WaveformTrack, {
			props: baseProps({ scrollLeft: 100, onseek, onscrubchange })
		});
		await tick();
		const track = getTrack(screen.container);
		const setCapture = vi.fn();
		track.setPointerCapture = setCapture;
		pointer(track, 'pointerdown', { clientX: 50, pointerType: 'mouse', button: 0 });
		expect(onseek).toHaveBeenCalledWith(15); // (100 + 50) / 10
		expect(onscrubchange).toHaveBeenCalledWith(true);
		expect(setCapture).toHaveBeenCalledWith(1);
	});

	it('clamps seeks into [0, duration]', async () => {
		const onseek = vi.fn();
		const screen = render(WaveformTrack, { props: baseProps({ onseek }) });
		await tick();
		const track = getTrack(screen.container);
		pointer(track, 'pointerdown', { clientX: 5000 });
		pointer(track, 'pointermove', { clientX: -30 });
		expect(onseek.mock.calls.map((c) => c[0])).toEqual([60, 0]);
	});

	it('scrubs on pointermove and stops seeking after pointerup', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(WaveformTrack, { props: baseProps({ onseek, onscrubchange }) });
		await tick();
		const track = getTrack(screen.container);
		pointer(track, 'pointerdown', { clientX: 100 });
		pointer(track, 'pointermove', { clientX: 240 });
		pointer(track, 'pointerup');
		pointer(track, 'pointermove', { clientX: 400 });
		expect(onseek.mock.calls.map((c) => c[0])).toEqual([10, 24]);
		expect(onscrubchange.mock.calls.map((c) => c[0])).toEqual([true, false]);
	});

	it('ends the scrub on pointercancel', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(WaveformTrack, { props: baseProps({ onseek, onscrubchange }) });
		await tick();
		const track = getTrack(screen.container);
		pointer(track, 'pointerdown', { clientX: 100 });
		pointer(track, 'pointercancel');
		pointer(track, 'pointermove', { clientX: 400 });
		expect(onseek).toHaveBeenCalledTimes(1);
		expect(onscrubchange.mock.calls.map((c) => c[0])).toEqual([true, false]);
	});

	it('ignores non-left mouse buttons', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(WaveformTrack, { props: baseProps({ onseek, onscrubchange }) });
		await tick();
		const track = getTrack(screen.container);
		pointer(track, 'pointerdown', { clientX: 100, pointerType: 'mouse', button: 2 });
		pointer(track, 'pointermove', { clientX: 200 });
		expect(onseek).not.toHaveBeenCalled();
		expect(onscrubchange).not.toHaveBeenCalled();
	});

	it('does not report scrub end for a pointerup without an active scrub', async () => {
		const onscrubchange = vi.fn();
		const screen = render(WaveformTrack, { props: baseProps({ onscrubchange }) });
		await tick();
		const track = getTrack(screen.container);
		pointer(track, 'pointerup');
		expect(onscrubchange).not.toHaveBeenCalled();
	});

	it('does not seek when duration is 0', async () => {
		const onseek = vi.fn();
		const onscrubchange = vi.fn();
		const screen = render(WaveformTrack, {
			props: baseProps({ duration: 0, onseek, onscrubchange })
		});
		await tick();
		const track = getTrack(screen.container);
		pointer(track, 'pointerdown', { clientX: 100 });
		expect(onseek).not.toHaveBeenCalled();
		// The scrub itself still arms; only the seek math is guarded.
		expect(onscrubchange).toHaveBeenCalledWith(true);
	});

	it('survives a full scrub without onseek/onscrubchange callbacks', async () => {
		const screen = render(WaveformTrack, { props: baseProps() });
		await tick();
		const track = getTrack(screen.container);
		expect(() => {
			pointer(track, 'pointerdown', { clientX: 100 });
			pointer(track, 'pointermove', { clientX: 200 });
			pointer(track, 'pointerup');
		}).not.toThrow();
	});
});
