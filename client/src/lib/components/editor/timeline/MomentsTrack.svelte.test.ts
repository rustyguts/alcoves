import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { ComponentProps } from 'svelte';
import MomentsTrack from './MomentsTrack.svelte';
import { FRAME_SECONDS } from '$lib/state/playback.svelte';
import type { TimeRange } from '$lib/utils/timeline-geometry';
import type { Moment } from '$lib/types/api';

type TrackProps = ComponentProps<typeof MomentsTrack>;

function makeMoment(over: Partial<Moment> = {}): Moment {
	return {
		id: 'm1',
		libraryId: 'lib1',
		fileId: 'file1',
		createdById: 'u1',
		name: 'Clip',
		description: '',
		startSeconds: 10,
		endSeconds: 40,
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
	};
}

// duration 100s at pxPerSec 10 → a 1000px track, so the pixel math stays integral
// and the snap threshold min(8px / 10, 1s) = 0.8s is meaningful.
function baseProps(over: Partial<TrackProps> = {}): TrackProps {
	return {
		moments: [makeMoment()],
		selectedId: null,
		duration: 100,
		pxPerSec: 10,
		currentTime: 0,
		pending: {},
		snapping: false,
		playheadLeftPx: 0,
		...over
	};
}

function renderTrack(over: Partial<TrackProps> = {}) {
	return render(MomentsTrack, { props: baseProps(over) });
}

function bar(container: ParentNode, id = 'm1'): HTMLElement {
	return container.querySelector(`[data-timeline-bar="${id}"]`) as HTMLElement;
}

function track(container: ParentNode): HTMLElement {
	return container.querySelector('[data-testid="moments-track"]') as HTMLElement;
}

function handle(container: ParentNode, which: 'start' | 'end', id = 'm1'): HTMLElement {
	return bar(container, id).querySelector(`[data-resize-handle="${which}"]`) as HTMLElement;
}

// Synthetic pointerIds are not "active" pointers, so the browser's real
// capture APIs would throw NotFoundError — stub them on the element that will
// receive the pointerdown BEFORE dispatching.
function stubPointerCapture(el: HTMLElement) {
	const setPointerCapture = vi.fn();
	const releasePointerCapture = vi.fn();
	Object.defineProperty(el, 'setPointerCapture', { configurable: true, value: setPointerCapture });
	Object.defineProperty(el, 'releasePointerCapture', {
		configurable: true,
		value: releasePointerCapture
	});
	return { setPointerCapture, releasePointerCapture };
}

function firePointer(el: HTMLElement, type: string, clientX: number, init: PointerEventInit = {}) {
	el.dispatchEvent(
		new PointerEvent(type, { pointerId: 1, clientX, bubbles: true, button: 0, ...init })
	);
}

function lastRange(fn: ReturnType<typeof vi.fn<(id: string, range: TimeRange) => void>>) {
	const [, range] = fn.mock.lastCall ?? [];
	return range;
}

afterEach(() => {
	// A completed mouse drag installs a one-shot capture-phase click suppressor
	// on window; flush any a test left behind so it can't eat the next test's
	// click.
	window.dispatchEvent(new MouseEvent('click'));
});

describe('MomentsTrack', () => {
	describe('bar geometry & styling', () => {
		it('positions and sizes bars from the server range', async () => {
			const screen = renderTrack();
			await tick();
			const el = bar(screen.container);
			expect(el.style.left).toBe('100px');
			expect(el.style.width).toBe('300px');
			expect(el.title).toContain('10.00s – 40.00s');
		});

		it('lets the pending prop override the server range', async () => {
			const screen = renderTrack({
				pending: { m1: { startSeconds: 15, endSeconds: 45 } }
			});
			await tick();
			const el = bar(screen.container);
			expect(el.style.left).toBe('150px');
			expect(el.style.width).toBe('300px');
			expect(el.title).toContain('15.00s – 45.00s');
		});

		it('never renders a bar narrower than 2px', async () => {
			const screen = renderTrack({
				moments: [makeMoment({ startSeconds: 5, endSeconds: 5.1 })]
			});
			await tick();
			expect(bar(screen.container).style.width).toBe('2px');
		});

		it('marks a pending moment dirty with warning styling and a dot', async () => {
			const screen = renderTrack({
				pending: { m1: { startSeconds: 15, endSeconds: 45 } }
			});
			await tick();
			const el = bar(screen.container);
			expect(el.classList.contains('border-warning')).toBe(true);
			expect(el.textContent).toContain('●');
		});

		it('keeps a clean moment on primary styling without the dirty dot', async () => {
			const screen = renderTrack();
			await tick();
			const el = bar(screen.container);
			expect(el.className).toContain('border-primary/60');
			expect(el.classList.contains('ring-2')).toBe(false);
			expect(el.textContent).not.toContain('●');
		});

		it('rings the selected bar in primary', async () => {
			const screen = renderTrack({ selectedId: 'm1' });
			await tick();
			const el = bar(screen.container);
			expect(el.classList.contains('ring-2')).toBe(true);
			expect(el.classList.contains('ring-primary')).toBe(true);
		});

		it('rings a selected dirty bar in warning', async () => {
			const screen = renderTrack({
				selectedId: 'm1',
				pending: { m1: { startSeconds: 15, endSeconds: 45 } }
			});
			await tick();
			const el = bar(screen.container);
			expect(el.classList.contains('ring-2')).toBe(true);
			expect(el.classList.contains('ring-warning')).toBe(true);
		});

		it('falls back to Untitled for a nameless moment', async () => {
			const screen = renderTrack({ moments: [makeMoment({ name: '' })] });
			await tick();
			const el = bar(screen.container);
			expect(el.getAttribute('aria-label')).toBe('Moment Untitled');
			expect(el.textContent).toContain('Untitled');
		});

		it('renders the moment name inside a scrim chip for readability', async () => {
			const screen = renderTrack();
			await tick();
			const name = bar(screen.container).querySelector('span.truncate') as HTMLElement;
			expect(name.textContent).toContain('Clip');
			expect(name.classList.contains('rounded')).toBe(true);
			expect(name.classList.contains('bg-black/55')).toBe(true);
		});

		it('renders resize handles as aria-hidden non-semantic divs', async () => {
			const screen = renderTrack();
			await tick();
			for (const which of ['start', 'end'] as const) {
				const h = handle(screen.container, which);
				expect(h.tagName).toBe('DIV');
				expect(h.getAttribute('aria-hidden')).toBe('true');
				expect(h.getAttribute('role')).toBeNull();
				expect(h.getAttribute('aria-label')).toBeNull();
			}
		});

		it('positions the playhead from playheadLeftPx', async () => {
			const screen = renderTrack({ playheadLeftPx: 250 });
			await tick();
			const playhead = screen.container.querySelector('.bg-blue-500') as HTMLElement;
			expect(playhead.style.left).toBe('250px');
		});
	});

	describe('status pill', () => {
		it('shows only when the bar is wider than 120px', async () => {
			// [0,12] × 10px/s = exactly 120px → hidden (strictly greater required)
			const hidden = renderTrack({ moments: [makeMoment({ startSeconds: 0, endSeconds: 12 })] });
			await tick();
			expect(hidden.container.textContent).not.toContain('Not processed');
			hidden.unmount();

			const shown = renderTrack({ moments: [makeMoment({ startSeconds: 0, endSeconds: 12.5 })] });
			await tick();
			expect(shown.container.textContent).toContain('Not processed');
		});

		it('labels a ready export at the current version Processed', async () => {
			const screen = renderTrack({
				moments: [makeMoment({ exportStatus: 'ready', exportVersion: 2, exportedVersion: 2 })]
			});
			await tick();
			expect(screen.container.textContent).toContain('Processed');
		});

		it('treats a ready export of a stale version as not processed', async () => {
			const screen = renderTrack({
				moments: [makeMoment({ exportStatus: 'ready', exportVersion: 2, exportedVersion: 1 })]
			});
			await tick();
			expect(screen.container.textContent).toContain('Not processed');
		});

		it('labels a failed export', async () => {
			const screen = renderTrack({ moments: [makeMoment({ exportStatus: 'failed' })] });
			await tick();
			expect(screen.container.textContent).toContain('Failed');
		});

		it('shows a progress ring with percent while processing', async () => {
			const screen = renderTrack({
				moments: [makeMoment({ exportStatus: 'processing', exportProgress: 60 })]
			});
			await tick();
			expect(screen.container.textContent).toContain('Processing 60%');
			const ring = screen.container.querySelector('svg circle[stroke-dasharray]');
			expect(ring).not.toBeNull();
			// 60% of the 2π·6 circumference ≈ 22.6
			const filled = Number(ring?.getAttribute('stroke-dasharray')?.split(' ')[0]);
			expect(filled).toBeCloseTo(0.6 * 2 * Math.PI * 6, 5);
		});

		it('shows an indeterminate spinner for a queued export without progress', async () => {
			const screen = renderTrack({
				moments: [makeMoment({ exportStatus: 'queued', exportProgress: null })]
			});
			await tick();
			expect(screen.container.textContent).toContain('Processing');
			expect(screen.container.textContent).not.toContain('%');
			expect(screen.container.querySelector('svg circle[stroke-dasharray]')).toBeNull();
		});
	});

	describe('pointer drags', () => {
		it('moves a bar body and emits a pending change plus drag-active toggles', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const ondragactive = vi.fn();
			const screen = renderTrack({ onpendingchange, ondragactive });
			await tick();
			const el = bar(screen.container);
			const capture = stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0);
			expect(ondragactive).toHaveBeenLastCalledWith(true);
			expect(capture.setPointerCapture).toHaveBeenCalledWith(1);
			firePointer(el, 'pointermove', 50); // +50px / 10px-per-s = +5s
			expect(onpendingchange).toHaveBeenLastCalledWith('m1', {
				startSeconds: 15,
				endSeconds: 45
			});
			firePointer(el, 'pointerup', 50);
			expect(ondragactive).toHaveBeenLastCalledWith(false);
			expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);
		});

		it('clamps a body move inside [0, duration]', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ onpendingchange });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0);
			firePointer(el, 'pointermove', 5000); // +500s, way past the end
			expect(onpendingchange).toHaveBeenLastCalledWith('m1', {
				startSeconds: 70,
				endSeconds: 100
			});
			firePointer(el, 'pointerup', 5000);
		});

		it('resizes the start edge via the left handle without moving the end', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ onpendingchange });
			await tick();
			const h = handle(screen.container, 'start');
			const capture = stubPointerCapture(h);
			firePointer(h, 'pointerdown', 0);
			firePointer(h, 'pointermove', 20); // +2s
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(12);
			// end untouched proves the handle's stopPropagation kept the bar from
			// also starting a body move.
			expect(range?.endSeconds).toBe(40);
			firePointer(h, 'pointerup', 20);
			expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);
		});

		it('resizes the end edge via the right handle without moving the start', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ onpendingchange });
			await tick();
			const h = handle(screen.container, 'end');
			stubPointerCapture(h);
			firePointer(h, 'pointerdown', 0);
			firePointer(h, 'pointermove', -20); // −2s
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBe(10);
			expect(range?.endSeconds).toBeCloseTo(38);
			firePointer(h, 'pointerup', -20);
		});

		it('never shrinks below the minimum length when resizing', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ onpendingchange });
			await tick();
			const h = handle(screen.container, 'end');
			stubPointerCapture(h);
			firePointer(h, 'pointerdown', 0);
			firePointer(h, 'pointermove', -1000); // −100s, far past the start edge
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBe(10);
			expect(range?.endSeconds).toBeCloseTo(10.05);
			firePointer(h, 'pointerup', -1000);
		});

		it('treats a sub-3px drag as a select, not a pending change', async () => {
			const onpendingchange = vi.fn();
			const onselect = vi.fn();
			const onseek = vi.fn();
			const screen = renderTrack({ onpendingchange, onselect, onseek });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 100);
			firePointer(el, 'pointermove', 102); // |2px| is not > 2 → not a drag
			firePointer(el, 'pointerup', 102);
			expect(onselect).toHaveBeenCalledWith('m1');
			expect(onpendingchange).not.toHaveBeenCalled();
			// no click suppressor was installed → the next track click still seeks
			const t = track(screen.container);
			const rect = t.getBoundingClientRect();
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
			expect(onseek).toHaveBeenCalledTimes(1);
			expect(onseek.mock.calls[0]?.[0]).toBeCloseTo(50);
		});

		it('ignores non-primary mouse buttons', async () => {
			const onselect = vi.fn();
			const ondragactive = vi.fn();
			const screen = renderTrack({ onselect, ondragactive });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0, { button: 2, pointerType: 'mouse' });
			expect(onselect).not.toHaveBeenCalled();
			expect(ondragactive).not.toHaveBeenCalled();
		});

		it('ends the drag on pointercancel', async () => {
			const ondragactive = vi.fn();
			const screen = renderTrack({ ondragactive });
			await tick();
			const el = bar(screen.container);
			const capture = stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0);
			firePointer(el, 'pointermove', 50);
			firePointer(el, 'pointercancel', 50);
			expect(ondragactive).toHaveBeenLastCalledWith(false);
			expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);
		});

		it('ignores a pointerup with no drag in progress', async () => {
			const ondragactive = vi.fn();
			const screen = renderTrack({ ondragactive });
			await tick();
			firePointer(bar(screen.container), 'pointerup', 0);
			expect(ondragactive).not.toHaveBeenCalled();
		});

		it('does not emit pending changes or seeks when pxPerSec is 0', async () => {
			const onpendingchange = vi.fn();
			const onseek = vi.fn();
			const ondragactive = vi.fn();
			const screen = renderTrack({ pxPerSec: 0, onpendingchange, onseek, ondragactive });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0);
			expect(ondragactive).toHaveBeenLastCalledWith(true);
			firePointer(el, 'pointermove', 50);
			firePointer(el, 'pointerup', 50);
			expect(onpendingchange).not.toHaveBeenCalled();
			track(screen.container).dispatchEvent(
				new MouseEvent('click', { clientX: 10, bubbles: true })
			);
			expect(onseek).not.toHaveBeenCalled();
		});

		it('survives drags, clicks and keys with no callbacks wired', async () => {
			const screen = renderTrack();
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0);
			firePointer(el, 'pointermove', 50);
			firePointer(el, 'pointerup', 50);
			el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
			el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(track(screen.container)).toBeTruthy();
		});
	});

	describe('snapping', () => {
		it('pulls a dragged end edge onto a neighboring start edge', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({
				snapping: true,
				moments: [makeMoment(), makeMoment({ id: 'm2', startSeconds: 40.5, endSeconds: 60 })],
				onpendingchange
			});
			await tick();
			const h = handle(screen.container, 'end');
			stubPointerCapture(h);
			firePointer(h, 'pointerdown', 0);
			firePointer(h, 'pointermove', 3); // raw end 40.3 → within 0.8s of m2's 40.5
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBe(10);
			expect(range?.endSeconds).toBeCloseTo(40.5);
			firePointer(h, 'pointerup', 3);
		});

		it('pulls a dragged start edge onto the playhead', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ snapping: true, currentTime: 20, onpendingchange });
			await tick();
			const h = handle(screen.container, 'start');
			stubPointerCapture(h);
			firePointer(h, 'pointerdown', 0);
			firePointer(h, 'pointermove', 97); // raw start 19.7 → snaps onto playhead 20
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(20);
			expect(range?.endSeconds).toBe(40);
			firePointer(h, 'pointerup', 97);
		});

		it('snaps the leading edge of a body move, preserving length', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ snapping: true, currentTime: 0, onpendingchange });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 200);
			firePointer(el, 'pointermove', 103); // raw start 0.3 → snaps onto playhead 0
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(0);
			expect(range?.endSeconds).toBeCloseTo(30);
			firePointer(el, 'pointerup', 103);
		});

		it('falls back to snapping the trailing edge of a body move', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({
				snapping: true,
				currentTime: 50,
				moments: [makeMoment(), makeMoment({ id: 'm2', startSeconds: 70.5, endSeconds: 90 })],
				onpendingchange
			});
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0);
			// raw {40.3, 70.3}: start is far from every candidate, but the trailing
			// edge is within threshold of m2's 70.5 start.
			firePointer(el, 'pointermove', 303);
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(40.5);
			expect(range?.endSeconds).toBeCloseTo(70.5);
			firePointer(el, 'pointerup', 303);
		});

		it('leaves a move unsnapped when nothing is within threshold', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({
				snapping: true,
				currentTime: 50,
				moments: [makeMoment(), makeMoment({ id: 'm2', startSeconds: 70.5, endSeconds: 90 })],
				onpendingchange
			});
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0);
			firePointer(el, 'pointermove', 110); // raw {21, 51} — 51 is 1s from the playhead, > 0.8s
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(21);
			expect(range?.endSeconds).toBeCloseTo(51);
			firePointer(el, 'pointerup', 110);
		});

		it('does not snap when snapping is off', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ snapping: false, currentTime: 20, onpendingchange });
			await tick();
			const h = handle(screen.container, 'start');
			stubPointerCapture(h);
			firePointer(h, 'pointerdown', 0);
			firePointer(h, 'pointermove', 97); // 19.7 stays 19.7 even 0.3s from the playhead
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(19.7);
			expect(range?.endSeconds).toBe(40);
			firePointer(h, 'pointerup', 97);
		});
	});

	describe('track click', () => {
		it('seeks to x/pxPerSec, clamped into [0, duration]', async () => {
			const onseek = vi.fn();
			const screen = renderTrack({ onseek });
			await tick();
			const t = track(screen.container);
			const rect = t.getBoundingClientRect();
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 1500, bubbles: true }));
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left - 50, bubbles: true }));
			expect(onseek).toHaveBeenCalledTimes(3);
			expect(onseek.mock.calls[0]?.[0]).toBeCloseTo(50);
			expect(onseek.mock.calls[1]?.[0]).toBe(100);
			expect(onseek.mock.calls[2]?.[0]).toBe(0);
		});

		it('selects on a direct bar click without seeking', async () => {
			const onselect = vi.fn();
			const onseek = vi.fn();
			const screen = renderTrack({ onselect, onseek });
			await tick();
			bar(screen.container).dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(onselect).toHaveBeenCalledWith('m1');
			expect(onseek).not.toHaveBeenCalled();
		});

		it('keeps handle clicks from bubbling into a select or seek', async () => {
			const onselect = vi.fn();
			const onseek = vi.fn();
			const screen = renderTrack({ onselect, onseek });
			await tick();
			handle(screen.container, 'start').dispatchEvent(new MouseEvent('click', { bubbles: true }));
			handle(screen.container, 'end').dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(onselect).not.toHaveBeenCalled();
			expect(onseek).not.toHaveBeenCalled();
		});

		it('suppresses exactly one click after a real mouse drag', async () => {
			const onseek = vi.fn();
			const screen = renderTrack({ onseek });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0, { pointerType: 'mouse' });
			firePointer(el, 'pointermove', 50, { pointerType: 'mouse' });
			firePointer(el, 'pointerup', 50, { pointerType: 'mouse' });
			const t = track(screen.container);
			const rect = t.getBoundingClientRect();
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
			expect(onseek).not.toHaveBeenCalled(); // eaten by the one-shot suppressor
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
			expect(onseek).toHaveBeenCalledTimes(1);
			expect(onseek.mock.calls[0]?.[0]).toBeCloseTo(50);
		});

		it('does not arm the suppressor for touch drags or pointercancel endings', async () => {
			const onseek = vi.fn();
			const screen = renderTrack({ onseek });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			// touch drag completing via pointerup never synthesizes a trailing click
			firePointer(el, 'pointerdown', 0, { pointerType: 'touch' });
			firePointer(el, 'pointermove', 50, { pointerType: 'touch' });
			firePointer(el, 'pointerup', 50, { pointerType: 'touch' });
			// neither does a mouse drag aborted by pointercancel
			firePointer(el, 'pointerdown', 0, { pointerType: 'mouse' });
			firePointer(el, 'pointermove', 50, { pointerType: 'mouse' });
			firePointer(el, 'pointercancel', 50, { pointerType: 'mouse' });
			// so the user's next genuine click still seeks
			const t = track(screen.container);
			const rect = t.getBoundingClientRect();
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
			expect(onseek).toHaveBeenCalledTimes(1);
			expect(onseek.mock.calls[0]?.[0]).toBeCloseTo(50);
		});

		it('disarms the suppressor on the next pointerdown when no click arrives', async () => {
			const onseek = vi.fn();
			const screen = renderTrack({ onseek });
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0, { pointerType: 'mouse' });
			firePointer(el, 'pointermove', 50, { pointerType: 'mouse' });
			firePointer(el, 'pointerup', 50, { pointerType: 'mouse' });
			const t = track(screen.container);
			const rect = t.getBoundingClientRect();
			// a fresh press anywhere disarms the suppressor…
			t.dispatchEvent(
				new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'mouse', bubbles: true })
			);
			// …so the click that follows seeks instead of being swallowed
			t.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
			expect(onseek).toHaveBeenCalledTimes(1);
			expect(onseek.mock.calls[0]?.[0]).toBeCloseTo(50);
		});

		it('disarms the suppressor when the component is destroyed', async () => {
			const screen = renderTrack();
			await tick();
			const el = bar(screen.container);
			stubPointerCapture(el);
			firePointer(el, 'pointerdown', 0, { pointerType: 'mouse' });
			firePointer(el, 'pointermove', 50, { pointerType: 'mouse' });
			firePointer(el, 'pointerup', 50, { pointerType: 'mouse' });
			screen.unmount();
			// an armed suppressor stops capture-phase propagation at window, so a
			// click reaching a document-level capture listener proves it disarmed.
			const docSpy = vi.fn();
			document.addEventListener('click', docSpy, true);
			try {
				document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				expect(docSpy).toHaveBeenCalledTimes(1);
			} finally {
				document.removeEventListener('click', docSpy, true);
			}
		});
	});

	describe('keyboard', () => {
		it('selects on Enter and consumes the event', async () => {
			const onselect = vi.fn();
			const screen = renderTrack({ onselect });
			await tick();
			const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
			const preventDefault = vi.spyOn(e, 'preventDefault');
			const stopPropagation = vi.spyOn(e, 'stopPropagation');
			bar(screen.container).dispatchEvent(e);
			expect(onselect).toHaveBeenCalledWith('m1');
			expect(preventDefault).toHaveBeenCalled();
			expect(stopPropagation).toHaveBeenCalled();
		});

		it('selects on Space without nudging', async () => {
			const onselect = vi.fn();
			const onpendingchange = vi.fn();
			const screen = renderTrack({ onselect, onpendingchange });
			await tick();
			const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
			bar(screen.container).dispatchEvent(e);
			expect(onselect).toHaveBeenCalledWith('m1');
			expect(onpendingchange).not.toHaveBeenCalled();
		});

		it('nudges right by one frame on ArrowRight and consumes the event', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const onselect = vi.fn();
			const screen = renderTrack({ onpendingchange, onselect });
			await tick();
			const e = new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				bubbles: true,
				cancelable: true
			});
			const preventDefault = vi.spyOn(e, 'preventDefault');
			const stopPropagation = vi.spyOn(e, 'stopPropagation');
			bar(screen.container).dispatchEvent(e);
			expect(onselect).toHaveBeenCalledWith('m1');
			expect(preventDefault).toHaveBeenCalled();
			expect(stopPropagation).toHaveBeenCalled();
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(10 + FRAME_SECONDS, 5);
			expect(range?.endSeconds).toBeCloseTo(40 + FRAME_SECONDS, 5);
		});

		it('nudges left by one second with Shift+ArrowLeft', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({ onpendingchange });
			await tick();
			const e = new KeyboardEvent('keydown', {
				key: 'ArrowLeft',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			});
			bar(screen.container).dispatchEvent(e);
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(9);
			expect(range?.endSeconds).toBeCloseTo(39);
		});

		it('clamps a left nudge at zero', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({
				moments: [makeMoment({ startSeconds: 0, endSeconds: 5 })],
				onpendingchange
			});
			await tick();
			bar(screen.container).dispatchEvent(
				new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
			);
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBe(0);
			expect(range?.endSeconds).toBe(5);
		});

		it('nudges from the effective pending range', async () => {
			const onpendingchange = vi.fn<(id: string, range: TimeRange) => void>();
			const screen = renderTrack({
				pending: { m1: { startSeconds: 20, endSeconds: 50 } },
				onpendingchange
			});
			await tick();
			bar(screen.container).dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'ArrowRight',
					shiftKey: true,
					bubbles: true,
					cancelable: true
				})
			);
			const range = lastRange(onpendingchange);
			expect(range?.startSeconds).toBeCloseTo(21);
			expect(range?.endSeconds).toBeCloseTo(51);
		});

		it('keeps consumed keys from reaching window, letting others bubble', async () => {
			const screen = renderTrack();
			await tick();
			const winSpy = vi.fn();
			window.addEventListener('keydown', winSpy);
			try {
				const el = bar(screen.container);
				el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
				el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
				el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
				expect(winSpy).not.toHaveBeenCalled();
				el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
				expect(winSpy).toHaveBeenCalledTimes(1);
			} finally {
				window.removeEventListener('keydown', winSpy);
			}
		});

		it('ignores unrelated keys', async () => {
			const onselect = vi.fn();
			const onpendingchange = vi.fn();
			const screen = renderTrack({ onselect, onpendingchange });
			await tick();
			bar(screen.container).dispatchEvent(
				new KeyboardEvent('keydown', { key: 'z', bubbles: true })
			);
			expect(onselect).not.toHaveBeenCalled();
			expect(onpendingchange).not.toHaveBeenCalled();
		});
	});
});
