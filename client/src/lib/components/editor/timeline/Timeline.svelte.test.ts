import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { ComponentProps } from 'svelte';
import Timeline from './Timeline.svelte';
import type { Moment } from '$lib/types/api';
import type { TimelineController, TimelineMarker } from '$lib/utils/timeline-geometry';

type Props = ComponentProps<typeof Timeline>;

const CONTAINER_WIDTH = 1000;

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

// duration 100s in a pinned 1000px viewport → 10 px/sec at zoom 1.
function baseProps(over: Partial<Props> = {}): Props {
	return {
		duration: 100,
		currentTime: 10,
		moments: [makeMoment()],
		selectedId: null,
		...over
	};
}

// onMount reads scrollEl.clientWidth; the headless offscreen container is
// 0-wide, which would leave pxPerSec at 0 and break all pixel math. Pin a
// deterministic 1000px on every element and restore it in afterEach.
function pinClientWidth(width = CONTAINER_WIDTH) {
	const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
		configurable: true,
		get() {
			return width;
		}
	});
	return () => {
		if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
	};
}

let restoreClientWidth: (() => void) | null = null;

function renderTimeline(over: Partial<Props> = {}) {
	restoreClientWidth ??= pinClientWidth();
	return render(Timeline, { props: baseProps(over) });
}

function scrollElOf(container: ParentNode): HTMLElement {
	return container.querySelector('.timeline-scroll') as HTMLElement;
}

// The browser clamps native scrollLeft to 0 for unscrollable offscreen
// elements; install a per-element backing field so writes stick and reads are
// deterministic. The element dies with the test, no restore needed.
function trackScrollLeft(el: HTMLElement): () => number {
	let value = 0;
	Object.defineProperty(el, 'scrollLeft', {
		configurable: true,
		get: () => value,
		set: (v: number) => {
			value = Math.max(0, v);
		}
	});
	return () => value;
}

function findButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll('button')).find((b) =>
		b.textContent?.includes(label)
	);
}

function barOf(container: ParentNode): HTMLElement {
	return container.querySelector('[data-timeline-bar]') as HTMLElement;
}

// Synthetic pointerIds make the real capture APIs throw — stub them per
// element BEFORE dispatching any pointer event.
function stubPointerCapture(el: HTMLElement) {
	el.setPointerCapture = vi.fn();
	el.releasePointerCapture = vi.fn();
}

function pointer(el: HTMLElement, type: string, clientX: number) {
	// pointerType 'mouse' is load-bearing: the post-drag click suppressor only
	// arms on a mouse pointerup (touch drags and pointercancel never produce
	// the trailing synthetic click, so they must not arm it).
	el.dispatchEvent(
		new PointerEvent(type, {
			pointerId: 1,
			pointerType: 'mouse',
			clientX,
			bubbles: true,
			button: 0
		})
	);
}

// Drag the (single) moment bar from fromX to toX and flush the one-shot
// capture-phase click suppressor a moved mouse drag installs on window.
async function dragBar(container: ParentNode, fromX: number, toX: number) {
	const bar = barOf(container);
	stubPointerCapture(bar);
	pointer(bar, 'pointerdown', fromX);
	pointer(bar, 'pointermove', toX);
	pointer(bar, 'pointerup', toX);
	await tick();
	window.dispatchEvent(new MouseEvent('click'));
}

function nudgeBar(container: ParentNode) {
	// Shift+ArrowRight = +1s exactly, so reconcile comparisons are float-clean.
	barOf(container).dispatchEvent(
		new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
	);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// Auto-follow yields while a user scroll happened within the last 1500ms.
// lastUserScrollAt starts at 0, so the guard reduces to performance.now() ≥
// 1500 — a fresh test iframe can still be inside that window. Pin now() far
// past it so follow behavior is deterministic; restored by vi.restoreAllMocks.
function mockNowPastScrollGrace(at = 60_000) {
	return vi.spyOn(performance, 'now').mockReturnValue(at);
}

afterEach(() => {
	// Flush any leftover one-shot click suppressor so it can't eat the next
	// test's click.
	window.dispatchEvent(new MouseEvent('click'));
	restoreClientWidth?.();
	restoreClientWidth = null;
	vi.restoreAllMocks();
});

describe('Timeline', () => {
	it('always renders the ruler and moments track; waveform and markers stay hidden', async () => {
		const screen = renderTimeline();
		await tick();
		expect(screen.container.querySelector('[data-testid="timeline-ruler"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="moments-track"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="waveform-track"]')).toBeNull();
		expect(screen.container.querySelector('[data-testid="markers-track"]')).toBeNull();
	});

	it('renders the waveform track only when peaks are non-empty and pps > 0', async () => {
		const screen = renderTimeline({
			waveformPeaks: [0.1, 0.6, 0.9, 0.3],
			waveformPeaksPerSecond: 50
		});
		await tick();
		expect(screen.container.querySelector('[data-testid="waveform-track"]')).not.toBeNull();
		expect(screen.container.querySelector('canvas')).not.toBeNull();

		await screen.rerender(baseProps({ waveformPeaks: [0.1, 0.6], waveformPeaksPerSecond: 0 }));
		await tick();
		expect(screen.container.querySelector('[data-testid="waveform-track"]')).toBeNull();

		await screen.rerender(baseProps({ waveformPeaks: [], waveformPeaksPerSecond: 50 }));
		await tick();
		expect(screen.container.querySelector('[data-testid="waveform-track"]')).toBeNull();

		await screen.rerender(baseProps({ waveformPeaks: [0.1, 0.6], waveformPeaksPerSecond: null }));
		await tick();
		expect(screen.container.querySelector('[data-testid="waveform-track"]')).toBeNull();
	});

	it('renders the markers track when markers exist and seeks from a marker', async () => {
		const onseek = vi.fn();
		const markers: TimelineMarker[] = [
			{
				id: 'k1',
				filterId: 'f1',
				name: 'Laughter',
				color: '#f59e0b',
				startSeconds: 3,
				title: 'Laughter · 0:03 · laughter'
			}
		];
		const screen = renderTimeline({ markers, onseek });
		await tick();
		expect(screen.container.querySelector('[data-testid="markers-track"]')).not.toBeNull();
		const marker = screen.container.querySelector(
			'[aria-label="Laughter · 0:03 · laughter"]'
		) as HTMLButtonElement;
		expect(marker).not.toBeNull();
		marker.click();
		expect(onseek).toHaveBeenLastCalledWith(3);
	});

	it('runs the pending-changes lifecycle: drag → Save changes (1) → onsavePending → reconcile clears', async () => {
		let resolveSave = () => {};
		const onsavePending = vi.fn(
			(_changes: Array<{ id: string; startSeconds: number; endSeconds: number }>) =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				})
		);
		const onselectMoment = vi.fn();
		const ondirtychange = vi.fn();
		const screen = renderTimeline({ onsavePending, onselectMoment, ondirtychange });
		await tick();
		expect(ondirtychange).toHaveBeenLastCalledWith(0);

		// +50px at 10 px/sec = +5s on the [10,40] moment
		await dragBar(screen.container, 0, 50);
		expect(onselectMoment).toHaveBeenLastCalledWith('m1');
		expect(ondirtychange).toHaveBeenLastCalledWith(1);

		const save = findButton(screen.container, 'Save changes');
		expect(save?.textContent).toContain('Save changes (1)');
		expect(save?.disabled).toBe(false);

		save?.click();
		await tick();
		expect(onsavePending).toHaveBeenCalledTimes(1);
		const changes = onsavePending.mock.calls[0]?.[0] ?? [];
		expect(changes).toHaveLength(1);
		expect(changes[0]?.id).toBe('m1');
		expect(changes[0]?.startSeconds).toBeCloseTo(15);
		expect(changes[0]?.endSeconds).toBeCloseTo(45);

		// NOT cleared eagerly — the entry stays pending while the save is in
		// flight (the button keeps the count and is disabled only by saving)
		const inflight = findButton(screen.container, 'Save changes');
		expect(inflight?.textContent).toContain('Save changes (1)');
		expect(inflight?.disabled).toBe(true);
		expect(ondirtychange).toHaveBeenLastCalledWith(1);

		// the save settling alone still doesn't clear — only the reconcile
		// effect drops entries once the server echoes the new values
		resolveSave();
		await flush();
		const settled = findButton(screen.container, 'Save changes');
		expect(settled?.textContent).toContain('Save changes (1)');
		expect(settled?.disabled).toBe(false);
		expect(ondirtychange).toHaveBeenLastCalledWith(1);

		// the moments prop echoes the saved range → reconcile drops the entry
		await screen.rerender(
			baseProps({
				onsavePending,
				onselectMoment,
				ondirtychange,
				moments: [makeMoment({ startSeconds: 15, endSeconds: 45 })]
			})
		);
		await tick();
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(true);
		expect(ondirtychange).toHaveBeenLastCalledWith(0);
	});

	it('keeps pending entries when onsavePending rejects (edits stay recoverable)', async () => {
		// savePending re-throws the rejection out of the fire-and-forget button
		// handler; registering a window listener keeps vitest from treating it
		// as an unexpected error while we assert the edits survived.
		const swallowRejection = (e: PromiseRejectionEvent) => e.preventDefault();
		window.addEventListener('unhandledrejection', swallowRejection);
		try {
			const ondirtychange = vi.fn();
			const onsavePending = vi.fn(() => Promise.reject(new Error('save failed')));
			const screen = renderTimeline({ onsavePending, ondirtychange });
			await tick();
			nudgeBar(screen.container); // pending → [11,41]
			await tick();
			expect(findButton(screen.container, 'Save changes')?.disabled).toBe(false);

			findButton(screen.container, 'Save changes')?.click();
			await tick();
			await flush();
			expect(onsavePending).toHaveBeenCalledTimes(1);

			// failed save → the entry survives and Save stays armed for a retry
			const save = findButton(screen.container, 'Save changes');
			expect(save?.textContent).toContain('Save changes (1)');
			expect(save?.disabled).toBe(false);
			expect(ondirtychange).toHaveBeenLastCalledWith(1);
			await flush(); // let the unhandledrejection task land before disarming
		} finally {
			window.removeEventListener('unhandledrejection', swallowRejection);
		}
	});

	it('does not create a pending change for a sub-3px drag (click = select)', async () => {
		const onselectMoment = vi.fn();
		const screen = renderTimeline({ onselectMoment });
		await tick();
		await dragBar(screen.container, 0, 2);
		expect(onselectMoment).toHaveBeenLastCalledWith('m1');
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(true);
	});

	it('reconciles pending entries away when the server sends matching values', async () => {
		const ondirtychange = vi.fn();
		const screen = renderTimeline({ ondirtychange });
		await tick();
		nudgeBar(screen.container); // pending → [11,41]
		await tick();
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(false);
		expect(ondirtychange).toHaveBeenLastCalledWith(1);

		// server still has the old values → pending survives
		await screen.rerender(
			baseProps({ ondirtychange, moments: [makeMoment({ startSeconds: 10, endSeconds: 40 })] })
		);
		await tick();
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(false);

		// server now matches the pending range (±1ms) → entry dropped
		await screen.rerender(
			baseProps({ ondirtychange, moments: [makeMoment({ startSeconds: 11, endSeconds: 41 })] })
		);
		await tick();
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(true);
		expect(ondirtychange).toHaveBeenLastCalledWith(0);
	});

	it('drops an orphaned pending entry when its moment leaves the server list', async () => {
		const ondirtychange = vi.fn();
		const screen = renderTimeline({ ondirtychange });
		await tick();
		nudgeBar(screen.container); // pending → [11,41]
		await tick();
		expect(ondirtychange).toHaveBeenLastCalledWith(1);
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(false);

		// the moment is deleted out from under the edit → the orphan must not
		// keep the dirty count / Save button / navigation guard stuck
		await screen.rerender(baseProps({ ondirtychange, moments: [] }));
		await tick();
		expect(ondirtychange).toHaveBeenLastCalledWith(0);
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(true);
	});

	it('hands up a controller that zooms (with clamping) and zooms to fit', async () => {
		let controller: TimelineController | null = null;
		const screen = renderTimeline({ oncontroller: (c) => (controller = c) });
		await tick();
		expect(controller).not.toBeNull();

		controller!.zoomIn();
		await tick();
		expect(screen.container.textContent).toContain('150%');

		controller!.zoomOut();
		await tick();
		expect(screen.container.textContent).toContain('100%');

		// already at MIN_ZOOM → no change
		controller!.zoomOut();
		await tick();
		expect(screen.container.textContent).toContain('100%');

		controller!.zoomIn();
		controller!.zoomToFit();
		await tick();
		expect(screen.container.textContent).toContain('100%');
	});

	it('controller scrollStep/centerPlayhead drive the scroll element', async () => {
		let controller: TimelineController | null = null;
		const screen = renderTimeline({ oncontroller: (c) => (controller = c) });
		await tick();
		const sc = scrollElOf(screen.container);
		sc.scrollTo = vi.fn();
		sc.scrollBy = vi.fn();

		// playhead at 10s × 10px/s = 100px, viewport 1000px
		controller!.centerPlayhead();
		expect(sc.scrollTo).toHaveBeenCalledWith({ left: 100 - 500, behavior: 'smooth' });

		controller!.scrollStep(1);
		expect(sc.scrollBy).toHaveBeenLastCalledWith({ left: 250, behavior: 'smooth' });
		controller!.scrollStep(-1);
		expect(sc.scrollBy).toHaveBeenLastCalledWith({ left: -250, behavior: 'smooth' });
	});

	it('controller exposes effective ranges, clearPending and hasPending', async () => {
		let controller: TimelineController | null = null;
		const screen = renderTimeline({ oncontroller: (c) => (controller = c) });
		await tick();

		// server values before any edit; null for unknown ids
		expect(controller!.getEffectiveRange('m1')).toEqual({ startSeconds: 10, endSeconds: 40 });
		expect(controller!.getEffectiveRange('missing')).toBeNull();
		expect(controller!.hasPending()).toBe(false);

		nudgeBar(screen.container); // pending → [11,41]
		await tick();
		expect(controller!.getEffectiveRange('m1')).toEqual({ startSeconds: 11, endSeconds: 41 });
		expect(controller!.hasPending()).toBe(true);

		// clearing an id with no pending entry is a no-op
		controller!.clearPending('missing');
		expect(controller!.hasPending()).toBe(true);

		controller!.clearPending('m1');
		expect(controller!.hasPending()).toBe(false);
		await tick();
		expect(findButton(screen.container, 'Save changes')?.disabled).toBe(true);
	});

	it('gates Split on a selection with the playhead strictly inside it', async () => {
		const onsplit = vi.fn();
		// no selection → disabled
		const screen = renderTimeline({ onsplit });
		await tick();
		const split = () =>
			screen.container.querySelector('[aria-label="Split at playhead"]') as HTMLButtonElement;
		expect(split().disabled).toBe(true);

		// selected but playhead on the start edge (< 0.05s inside) → disabled
		await screen.rerender(baseProps({ onsplit, selectedId: 'm1', currentTime: 10 }));
		await tick();
		expect(split().disabled).toBe(true);

		// selected but playhead past the end → disabled
		await screen.rerender(baseProps({ onsplit, selectedId: 'm1', currentTime: 50 }));
		await tick();
		expect(split().disabled).toBe(true);

		// selected with the playhead inside → enabled, fires onsplit
		await screen.rerender(baseProps({ onsplit, selectedId: 'm1', currentTime: 20 }));
		await tick();
		expect(split().disabled).toBe(false);
		split().click();
		expect(onsplit).toHaveBeenCalledTimes(1);
	});

	it('zooms with ctrl+wheel keeping the playhead at the same screen x', async () => {
		const screen = renderTimeline();
		await tick();
		const sc = scrollElOf(screen.container);
		const getScrollLeft = trackScrollLeft(sc);

		sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, cancelable: true }));
		await tick();
		expect(screen.container.textContent).toContain('150%');
		await flush();
		// playhead was at 100px on screen; at 15px/s it sits at 150px → scroll 50
		expect(getScrollLeft()).toBe(50);

		sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, cancelable: true }));
		await tick();
		expect(screen.container.textContent).toContain('100%');

		// cmd+wheel (metaKey) zooms exactly like ctrl+wheel
		sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, metaKey: true, cancelable: true }));
		await tick();
		expect(screen.container.textContent).toContain('150%');
	});

	it('scrolls with a plain wheel and ignores zero-delta events', async () => {
		const screen = renderTimeline();
		await tick();
		const sc = scrollElOf(screen.container);
		const getScrollLeft = trackScrollLeft(sc);

		sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, cancelable: true }));
		expect(getScrollLeft()).toBe(30);

		// horizontal-dominant delta scrolls by deltaX
		sc.dispatchEvent(new WheelEvent('wheel', { deltaX: 40, deltaY: 5, cancelable: true }));
		expect(getScrollLeft()).toBe(70);

		sc.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: 0, cancelable: true }));
		expect(getScrollLeft()).toBe(70);
	});

	it('auto-follows the playhead while zoomed in', async () => {
		mockNowPastScrollGrace();
		let controller: TimelineController | null = null;
		const oncontroller = (c: TimelineController) => (controller = c);
		const screen = renderTimeline({ oncontroller });
		await tick();
		const sc = scrollElOf(screen.container);
		const getScrollLeft = trackScrollLeft(sc);

		controller!.zoomIn(); // 150% → 15 px/s, playhead-stable scroll = 50
		await tick();
		await flush();
		expect(getScrollLeft()).toBe(50);

		// playhead jumps to 90s → 1350px; screenX 1300 > 960 → recenter at 850
		await screen.rerender(baseProps({ oncontroller, currentTime: 90 }));
		await tick();
		await vi.waitFor(() => expect(getScrollLeft()).toBe(850));

		// playhead jumps back near the start → screenX < 40px margin → clamp to 0
		await screen.rerender(baseProps({ oncontroller, currentTime: 5 }));
		await tick();
		await vi.waitFor(() => expect(getScrollLeft()).toBe(0));
	});

	it('suspends auto-follow after a user scroll, then resumes past the grace window', async () => {
		const now = mockNowPastScrollGrace(10_000);
		let controller: TimelineController | null = null;
		const oncontroller = (c: TimelineController) => (controller = c);
		const screen = renderTimeline({ oncontroller });
		await tick();
		const sc = scrollElOf(screen.container);
		const getScrollLeft = trackScrollLeft(sc);

		controller!.zoomIn(); // 150% → 15 px/s, playhead-stable scroll = 50
		await tick();
		await flush();
		expect(getScrollLeft()).toBe(50);

		// a scroll the follow effect didn't write itself = the user scrolling
		// somewhere on purpose → marks lastUserScrollAt
		sc.scrollLeft = 300;
		sc.dispatchEvent(new Event('scroll'));
		await tick();

		// playhead jumps off-screen inside the grace window → viewport stays put
		await screen.rerender(baseProps({ oncontroller, currentTime: 90 }));
		await tick();
		await flush();
		expect(getScrollLeft()).toBe(300);

		// grace window elapses → the next playhead move recenters again
		// (91s × 15px/s = 1365px → recenter at 1365 − 500)
		now.mockReturnValue(12_000);
		await screen.rerender(baseProps({ oncontroller, currentTime: 91 }));
		await tick();
		await vi.waitFor(() => expect(getScrollLeft()).toBe(865));
	});

	it('does not auto-follow while a ruler scrub is active, then resumes on release', async () => {
		mockNowPastScrollGrace();
		let controller: TimelineController | null = null;
		const oncontroller = (c: TimelineController) => (controller = c);
		const screen = renderTimeline({ oncontroller });
		await tick();
		const sc = scrollElOf(screen.container);
		const getScrollLeft = trackScrollLeft(sc);

		controller!.zoomIn(); // 150% → playhead-stable scroll = 50
		await tick();
		await flush();
		expect(getScrollLeft()).toBe(50);

		const ruler = screen.container.querySelector('[data-testid="timeline-ruler"]') as HTMLElement;
		stubPointerCapture(ruler);
		pointer(ruler, 'pointerdown', 0); // scrub begins → dragActive
		await tick();

		// playhead moves far off-screen mid-scrub → viewport must NOT be yanked
		await screen.rerender(baseProps({ oncontroller, currentTime: 90 }));
		await tick();
		await flush();
		expect(getScrollLeft()).toBe(50);

		// releasing the scrub re-enables auto-follow → recenter at 1350 − 500
		pointer(ruler, 'pointerup', 0);
		await tick();
		await vi.waitFor(() => expect(getScrollLeft()).toBe(850));
	});

	it('seeks from a click on the moments track', async () => {
		const onseek = vi.fn();
		const screen = renderTimeline({ onseek });
		await tick();
		const track = screen.container.querySelector('[data-testid="moments-track"]') as HTMLElement;
		const rect = track.getBoundingClientRect();
		track.dispatchEvent(new MouseEvent('click', { clientX: rect.left + 500, bubbles: true }));
		expect(onseek).toHaveBeenCalledTimes(1);
		expect(onseek.mock.calls.at(-1)?.[0]).toBeCloseTo(50);
	});

	it('forwards toolbar callbacks and survives missing ones', async () => {
		const ontogglesnap = vi.fn();
		const oncreateMoment = vi.fn();
		const screen = renderTimeline({ ontogglesnap, oncreateMoment, snapping: true });
		await tick();
		const snap = screen.container.querySelector(
			'[aria-label="Toggle snapping"]'
		) as HTMLButtonElement;
		expect(snap.getAttribute('aria-pressed')).toBe('true');
		snap.click();
		findButton(screen.container, 'New moment')?.click();
		expect(ontogglesnap).toHaveBeenCalledTimes(1);
		expect(oncreateMoment).toHaveBeenCalledTimes(1);

		// every callback prop optional — clicks must not throw without them
		const bare = renderTimeline();
		await tick();
		expect(() => {
			(bare.container.querySelector('[aria-label="Toggle snapping"]') as HTMLButtonElement).click();
			findButton(bare.container, 'New moment')?.click();
		}).not.toThrow();
	});

	it('unmounts cleanly and the controller verbs become safe no-ops', async () => {
		let controller: TimelineController | null = null;
		const screen = renderTimeline({ oncontroller: (c) => (controller = c) });
		await tick();
		// queue zoomAt's deferred scroll write, then unmount before it lands —
		// the microtask must bail on the unbound scroll element
		controller!.zoomIn();
		expect(() => screen.unmount()).not.toThrow();
		await flush();
		expect(() => {
			controller!.centerPlayhead();
			controller!.scrollStep(1);
		}).not.toThrow();
	});
});
