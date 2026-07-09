<script lang="ts">
	/**
	 * WaveformTrack — the audio amplitude track of the timeline.
	 *
	 * The canvas is viewport-pinned (sticky left) and only ever draws the
	 * visible region — at 50× zoom the full timeline width would blow past the
	 * browser's maximum canvas size, so the renderer translates by scrollLeft
	 * instead of widening the canvas. Because of that, pointer x-coordinates
	 * are viewport-relative and need scrollLeft added back before converting
	 * to seconds. Press/drag to scrub, same as the ruler.
	 */
	import { createWaveformRenderer } from '$lib/state/waveform-renderer';

	interface Props {
		peaks: number[];
		peaksPerSecond: number;
		duration: number;
		pxPerSec: number;
		scrollLeft: number;
		viewportWidth: number;
		playheadLeftPx: number;
		onseek?: (seconds: number) => void;
		onscrubchange?: (active: boolean) => void;
	}

	let {
		peaks,
		peaksPerSecond,
		duration,
		pxPerSec,
		scrollLeft,
		viewportWidth,
		playheadLeftPx,
		onseek,
		onscrubchange
	}: Props = $props();

	const WAVEFORM_HEIGHT = 56;

	let rowEl = $state<HTMLElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let scrubbing = false;

	const renderer = createWaveformRenderer({
		getCanvas: () => canvasEl,
		getPeaks: () => peaks,
		getPeaksPerSecond: () => peaksPerSecond,
		getPxPerSec: () => pxPerSec,
		getScrollLeft: () => scrollLeft,
		getViewportWidth: () => viewportWidth,
		getHeight: () => WAVEFORM_HEIGHT
	});

	// Redraw whenever any reactive input — including the canvas mount — changes.
	$effect(() => {
		void canvasEl;
		void peaks;
		void peaksPerSecond;
		void pxPerSec;
		void scrollLeft;
		void viewportWidth;
		renderer.redraw();
	});

	function seekFromEvent(e: PointerEvent) {
		const el = rowEl;
		if (!el || !duration || pxPerSec <= 0) return;
		const rect = el.getBoundingClientRect();
		// Sticky row: rect.left is the viewport edge of the scroll container, so
		// x is viewport-relative — add scrollLeft to recover timeline position.
		const x = e.clientX - rect.left;
		const seconds = (scrollLeft + x) / pxPerSec;
		onseek?.(Math.max(0, Math.min(duration, seconds)));
	}

	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		scrubbing = true;
		onscrubchange?.(true);
		rowEl?.setPointerCapture?.(e.pointerId);
		seekFromEvent(e);
	}

	function onPointerMove(e: PointerEvent) {
		if (!scrubbing) return;
		seekFromEvent(e);
	}

	function endScrub() {
		if (!scrubbing) return;
		scrubbing = false;
		onscrubchange?.(false);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={rowEl}
	class="waveform-row relative cursor-pointer touch-none border-t bg-muted/40"
	style="width: {viewportWidth}px; height: {WAVEFORM_HEIGHT}px;"
	data-testid="waveform-track"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={endScrub}
	onpointercancel={endScrub}
>
	<canvas
		bind:this={canvasEl}
		class="block"
		style="width: {viewportWidth}px; height: {WAVEFORM_HEIGHT}px;"
	></canvas>
	<span
		class="pointer-events-none absolute top-1 left-1 rounded bg-muted/80 px-1 text-[9px] font-medium tracking-wide text-muted-foreground uppercase"
	>
		Audio
	</span>
	<!-- Viewport-pinned playhead — same deliberate blue accent as the ruler. -->
	<div
		class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-blue-500"
		style="left: {playheadLeftPx - scrollLeft}px;"
	></div>
</div>

<style>
	.waveform-row {
		position: sticky;
		left: 0;
	}
</style>
