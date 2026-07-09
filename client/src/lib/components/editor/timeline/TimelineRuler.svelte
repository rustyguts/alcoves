<script lang="ts">
	/**
	 * TimelineRuler — the tick strip above the tracks.
	 *
	 * Ticks come from the shared NICE_STEPS ladder in timeline-geometry. The
	 * whole strip is a pointer-scrub surface: press to seek, keep dragging to
	 * scrub (pointer capture; touch-action: none so touch drags scrub instead
	 * of panning the page). It is deliberately NOT focusable — keyboard seeking
	 * goes through the global shortcut map, and a focusable ruler would swallow
	 * Space right after a click-to-seek.
	 */
	import { buildTicks } from '$lib/utils/timeline-geometry';

	interface Props {
		duration: number;
		pxPerSec: number;
		playheadLeftPx: number;
		onseek?: (seconds: number) => void;
		onscrubchange?: (active: boolean) => void;
	}

	let { duration, pxPerSec, playheadLeftPx, onseek, onscrubchange }: Props = $props();

	const ticks = $derived(buildTicks(duration, pxPerSec));

	let rulerEl = $state<HTMLElement | null>(null);
	let scrubbing = false;

	function seekFromEvent(e: PointerEvent) {
		const el = rulerEl;
		if (!el || !duration || pxPerSec <= 0) return;
		const rect = el.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const seconds = x / pxPerSec;
		onseek?.(Math.max(0, Math.min(duration, seconds)));
	}

	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		scrubbing = true;
		onscrubchange?.(true);
		rulerEl?.setPointerCapture?.(e.pointerId);
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
	bind:this={rulerEl}
	class="relative h-5 w-full cursor-pointer touch-none border-b hover:bg-muted"
	data-testid="timeline-ruler"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={endScrub}
	onpointercancel={endScrub}
>
	{#each ticks as t (t.seconds)}
		<div
			class="pointer-events-none absolute top-0 bottom-0 {t.major
				? 'w-px bg-muted-foreground/60'
				: 'w-px bg-border'}"
			style="left: {t.leftPx}px;"
		>
			{#if t.label}
				<span
					class="absolute top-0 left-1 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums"
				>
					{t.label}
				</span>
			{/if}
		</div>
	{/each}
	<!-- Ruler playhead indicator — kept a deliberate blue accent (distinct from
	     selection/primary tint) so the playhead reads consistently across the
	     ruler, moments track and waveform. -->
	<div
		class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-blue-500"
		style="left: {playheadLeftPx}px;"
	></div>
</div>
