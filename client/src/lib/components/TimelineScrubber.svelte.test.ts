import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import TimelineScrubber from './TimelineScrubber.svelte';
import type { TimelineBucket } from '$lib/state/library-timeline.svelte';

// Newest-first per-month density buckets spanning three years. Cumulative count
// total = 30, so the 2025 boundary sits at 13/30 and the 2024 boundary at 25/30.
const BUCKETS: TimelineBucket[] = [
	{ year: 2026, month: 1, count: 13 },
	{ year: 2025, month: 12, count: 8 },
	{ year: 2025, month: 7, count: 4 },
	{ year: 2024, month: 11, count: 5 }
];

describe('TimelineScrubber', () => {
	it('renders one year label per distinct year, newest-first', async () => {
		const screen = render(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
		const years = [...screen.container.querySelectorAll('button')].map((b) =>
			b.textContent?.trim()
		);
		expect(years).toEqual(['2026', '2025', '2024']);
	});

	it('renders one density blip per bucket', async () => {
		const screen = render(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
		const blips = screen.container.querySelectorAll("span[aria-hidden='true']");
		expect(blips).toHaveLength(BUCKETS.length);
	});

	it('exposes an accessible slider handle reflecting progress', async () => {
		const screen = render(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0.5 } });
		const slider = screen.container.querySelector("[role='slider']")!;
		expect(slider.getAttribute('aria-valuemin')).toBe('0');
		expect(slider.getAttribute('aria-valuemax')).toBe('100');
		expect(slider.getAttribute('aria-valuenow')).toBe('50');
		// aria-valuetext is the period at that fraction (cumulative-count mapping).
		expect(slider.getAttribute('aria-valuetext')).toBeTruthy();
	});

	it('calls onscrub with the year start fraction when a year label is clicked', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0, onscrub }
		});
		// Index 1 = the 2025 label, whose range begins at 13/30.
		const buttons = screen.container.querySelectorAll('button');
		(buttons[1] as HTMLButtonElement).click();
		expect(onscrub).toHaveBeenCalledWith(13 / 30);
	});

	it('supports keyboard scrubbing (Home / End / arrows)', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0.4, onscrub }
		});
		const slider = screen.container.querySelector("[role='slider']") as HTMLElement;

		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		expect(onscrub).toHaveBeenLastCalledWith(0);

		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		expect(onscrub).toHaveBeenLastCalledWith(1);

		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		// nudge(+0.05) from progress 0.4 → 0.45 (allow float wobble).
		expect(onscrub.mock.lastCall?.[0]).toBeCloseTo(0.45, 5);
	});

	it('calls onscrub with a fraction from the drag position on pointerdown', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0, onscrub }
		});
		const track = screen.container.querySelector('.cursor-ns-resize') as HTMLElement;
		mockTrackRect(track);

		track.dispatchEvent(
			new PointerEvent('pointerdown', { clientY: 200, pointerId: 1, bubbles: true })
		);
		// 200 / 400 = 0.5 down the rail.
		expect(onscrub).toHaveBeenLastCalledWith(0.5);
	});

	it('continues firing onscrub while dragging and stops after pointerup', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0, onscrub }
		});
		const track = screen.container.querySelector('.cursor-ns-resize') as HTMLElement;
		mockTrackRect(track);
		// setPointerCapture / releasePointerCapture aren't implemented in jsdom-style
		// envs; stub them so the optional-chained calls have something to hit.
		track.setPointerCapture = vi.fn();
		track.releasePointerCapture = vi.fn();

		track.dispatchEvent(
			new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true })
		);
		expect(onscrub).toHaveBeenLastCalledWith(0.25);
		expect(track.setPointerCapture).toHaveBeenCalledWith(1);

		// Moving while dragging keeps scrubbing.
		track.dispatchEvent(
			new PointerEvent('pointermove', { clientY: 300, pointerId: 1, bubbles: true })
		);
		expect(onscrub).toHaveBeenLastCalledWith(0.75);

		// pointerup releases the capture and ends the drag.
		track.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
		expect(track.releasePointerCapture).toHaveBeenCalledWith(1);

		// A subsequent plain move (no drag) should not scrub again.
		const callsBefore = onscrub.mock.calls.length;
		track.dispatchEvent(
			new PointerEvent('pointermove', { clientY: 50, pointerId: 1, bubbles: true })
		);
		expect(onscrub.mock.calls.length).toBe(callsBefore);
	});

	it('shows a hover date bubble on pointermove and hides it on leave', async () => {
		const screen = render(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
		const track = screen.container.querySelector('.cursor-ns-resize') as HTMLElement;
		mockTrackRect(track);

		// No bubble before hovering.
		expect(screen.container.querySelector('.shadow.ring-1')).toBeNull();

		// Hover near the top → bubble appears with a period label.
		track.dispatchEvent(
			new PointerEvent('pointermove', { clientY: 20, pointerId: 1, bubbles: true })
		);
		await tick();
		const bubble = screen.container.querySelector('.shadow.ring-1');
		expect(bubble).not.toBeNull();
		expect(bubble?.textContent?.trim()).toBeTruthy();

		// Leaving the rail (while not dragging) clears the hover bubble.
		track.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, bubbles: true }));
		await tick();
		expect(screen.container.querySelector('.shadow.ring-1')).toBeNull();
	});

	it('keeps scrubbing on pointermove during a drag begun on the rail', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0, onscrub }
		});
		const track = screen.container.querySelector('.cursor-ns-resize') as HTMLElement;
		mockTrackRect(track);
		track.setPointerCapture = vi.fn();
		track.releasePointerCapture = vi.fn();

		// Drag past the bottom: clamped to 1 (clientY beyond the rail height).
		track.dispatchEvent(
			new PointerEvent('pointerdown', { clientY: 600, pointerId: 1, bubbles: true })
		);
		expect(onscrub).toHaveBeenLastCalledWith(1);

		// Negative clientY clamps to 0.
		track.dispatchEvent(
			new PointerEvent('pointermove', { clientY: -50, pointerId: 1, bubbles: true })
		);
		expect(onscrub).toHaveBeenLastCalledWith(0);
	});

	it('ignores pointerup when not dragging (no release call)', async () => {
		const screen = render(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
		const track = screen.container.querySelector('.cursor-ns-resize') as HTMLElement;
		track.releasePointerCapture = vi.fn();

		track.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
		expect(track.releasePointerCapture).not.toHaveBeenCalled();
	});

	it('keeps the hover bubble while leaving mid-drag', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0, onscrub }
		});
		const track = screen.container.querySelector('.cursor-ns-resize') as HTMLElement;
		mockTrackRect(track);
		track.setPointerCapture = vi.fn();

		// Begin a drag → bubble is driven by the drag fraction.
		track.dispatchEvent(
			new PointerEvent('pointerdown', { clientY: 200, pointerId: 1, bubbles: true })
		);
		await tick();
		expect(screen.container.querySelector('.shadow.ring-1')).not.toBeNull();

		// Leaving while dragging does NOT clear the bubble (hoverFrac untouched).
		track.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, bubbles: true }));
		await tick();
		expect(screen.container.querySelector('.shadow.ring-1')).not.toBeNull();
	});

	it('handles every keyboard scrub key and ignores unrelated keys', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0.5, onscrub }
		});
		const slider = screen.container.querySelector("[role='slider']") as HTMLElement;

		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(onscrub.mock.lastCall?.[0]).toBeCloseTo(0.45, 5);

		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(onscrub.mock.lastCall?.[0]).toBeCloseTo(0.55, 5);

		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
		expect(onscrub.mock.lastCall?.[0]).toBeCloseTo(0.3, 5);

		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
		expect(onscrub.mock.lastCall?.[0]).toBeCloseTo(0.7, 5);

		// An unhandled key returns early — no further onscrub calls.
		const callsBefore = onscrub.mock.calls.length;
		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(onscrub.mock.calls.length).toBe(callsBefore);
	});

	it('clamps keyboard nudges to the 0..1 range at the extremes', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0, onscrub }
		});
		const slider = screen.container.querySelector("[role='slider']") as HTMLElement;

		// At the top, nudging up clamps to 0.
		slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
		expect(onscrub).toHaveBeenLastCalledWith(0);
	});

	it('renders nothing dynamic and labels gracefully with empty buckets', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: [], progress: 0, onscrub }
		});
		// No year labels, no density blips.
		expect(screen.container.querySelectorAll('button')).toHaveLength(0);
		expect(screen.container.querySelectorAll("span[aria-hidden='true']")).toHaveLength(0);

		// The slider still exists; its aria-valuetext is the empty-bucket fallback ('').
		const slider = screen.container.querySelector("[role='slider']")!;
		expect(slider.getAttribute('aria-valuetext')).toBe('');
	});

	it('falls back to the last bucket label when the fraction overshoots cumulative counts', async () => {
		// progress > 1 drives handleFrac/labelAt past the cumulative total, so the
		// for-loop never returns and the trailing last-bucket fallback fires.
		const screen = render(TimelineScrubber, { props: { buckets: BUCKETS, progress: 2 } });
		const slider = screen.container.querySelector("[role='slider']")!;
		// Last (oldest) bucket is Nov 2024.
		expect(slider.getAttribute('aria-valuetext')).toBe('Nov 2024');
	});

	it('treats a zero-height rail as fraction 0 on pointerdown', async () => {
		const onscrub = vi.fn();
		const screen = render(TimelineScrubber, {
			props: { buckets: BUCKETS, progress: 0, onscrub }
		});
		const track = screen.container.querySelector('.cursor-ns-resize') as HTMLElement;
		// A collapsed rail (height 0) guards against divide-by-zero → fraction 0.
		vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
			top: 0,
			height: 0,
			left: 0,
			right: 56,
			bottom: 0,
			width: 56,
			x: 0,
			y: 0,
			toJSON: () => ({})
		} as DOMRect);
		track.setPointerCapture = vi.fn();

		track.dispatchEvent(
			new PointerEvent('pointerdown', { clientY: 200, pointerId: 1, bubbles: true })
		);
		expect(onscrub).toHaveBeenLastCalledWith(0);
	});

	it('renders a numeric month label when the month index is out of range', async () => {
		// monthName falls back to String(m) when month is not in 1..12.
		const odd: TimelineBucket[] = [{ year: 2020, month: 13, count: 1 }];
		const screen = render(TimelineScrubber, { props: { buckets: odd, progress: 0 } });
		const slider = screen.container.querySelector("[role='slider']")!;
		expect(slider.getAttribute('aria-valuetext')).toBe('13 2020');
	});
});

function mockTrackRect(track: HTMLElement) {
	vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
		top: 0,
		height: 400,
		left: 0,
		right: 56,
		bottom: 400,
		width: 56,
		x: 0,
		y: 0,
		toJSON: () => ({})
	} as DOMRect);
}
