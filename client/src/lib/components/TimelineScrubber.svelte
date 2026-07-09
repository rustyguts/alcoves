<script lang="ts">
	/**
	 * Timeline date scrubber — a slim rail down the right edge of the timeline
	 * (Google-Photos style). Maps the whole library's date span to the rail height,
	 * newest at the top. It renders:
	 *   - year labels at each year boundary (click to jump),
	 *   - per-month density "blips" whose length scales with that month's count, so
	 *     you can see where photos cluster,
	 *   - a draggable handle synced to the gallery's scroll position, with a date
	 *     bubble showing the period under the handle.
	 *
	 * Positions are laid out by *cumulative count* (so a busy month occupies more
	 * rail than a sparse one), which tracks the gallery's scroll height. The parent
	 * owns the scroll: dragging/clicking calls `onscrub` with a 0..1 fraction and the
	 * parent scrolls proportionally; the parent feeds the live scroll position back
	 * via `progress` so the handle follows normal scrolling too.
	 */
	import type { TimelineBucket } from '$lib/state/library-timeline.svelte';

	interface Props {
		/** Per-month density buckets, newest-first. */
		buckets: TimelineBucket[];
		/** Current scroll fraction 0..1 (0 = top = newest), for handle sync. */
		progress: number;
		/** Emitted with a 0..1 fraction on drag/click/keyboard scrub. */
		onscrub?: (fraction: number) => void;
	}

	let { buckets, progress, onscrub }: Props = $props();

	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	function monthName(m: number): string {
		return MONTHS[m - 1] ?? String(m);
	}

	const total = $derived(buckets.reduce((s, b) => s + b.count, 0));
	const maxCount = $derived(buckets.reduce((m, b) => Math.max(m, b.count), 0));

	interface Mark {
		bucket: TimelineBucket;
		/** Fraction (0..1) of the rail where this bucket begins. */
		startFrac: number;
		/** Fraction of the rail at the bucket's midpoint (blip anchor). */
		midFrac: number;
		/** 0..1 relative to the busiest month — drives blip length. */
		density: number;
		/** First (newest) bucket of its year — gets a year label. */
		yearStart: boolean;
	}

	const marks = $derived.by<Mark[]>(() => {
		const t = total || 1;
		const mx = maxCount || 1;
		let cum = 0;
		let prevYear = Number.NaN;
		return buckets.map((b) => {
			const startFrac = cum / t;
			cum += b.count;
			const endFrac = cum / t;
			const yearStart = b.year !== prevYear;
			prevYear = b.year;
			return {
				bucket: b,
				startFrac,
				midFrac: (startFrac + endFrac) / 2,
				density: b.count / mx,
				yearStart
			};
		});
	});

	const yearMarks = $derived(marks.filter((m) => m.yearStart));

	const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

	// Period label at a rail fraction, by cumulative count (matches `marks`).
	function labelAt(frac: number): string {
		const t = total || 1;
		const target = frac * t;
		let cum = 0;
		for (const b of buckets) {
			cum += b.count;
			if (target <= cum) return `${monthName(b.month)} ${b.year}`;
		}
		const last = buckets[buckets.length - 1];
		return last ? `${monthName(last.month)} ${last.year}` : '';
	}

	let trackEl = $state<HTMLElement | null>(null);
	let dragging = $state(false);
	let dragFrac = $state(0);
	let hoverFrac = $state<number | null>(null);

	// Where the handle sits: the live drag fraction while dragging (instant
	// feedback), otherwise the scroll-driven progress from the parent.
	const handleFrac = $derived(clamp01(dragging ? dragFrac : progress));

	const bubbleFrac = $derived(dragging ? dragFrac : (hoverFrac ?? 0));
	const bubbleVisible = $derived(dragging || hoverFrac !== null);
	const bubbleLabel = $derived(labelAt(bubbleFrac));

	function fracFromEvent(e: PointerEvent): number {
		const el = trackEl;
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		if (rect.height <= 0) return 0;
		return clamp01((e.clientY - rect.top) / rect.height);
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		const f = fracFromEvent(e);
		dragFrac = f;
		trackEl?.setPointerCapture?.(e.pointerId);
		onscrub?.(f);
		e.preventDefault();
	}

	function onPointerMove(e: PointerEvent) {
		const f = fracFromEvent(e);
		if (dragging) {
			dragFrac = f;
			onscrub?.(f);
		} else {
			hoverFrac = f;
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		trackEl?.releasePointerCapture?.(e.pointerId);
	}

	function onPointerLeave() {
		if (!dragging) hoverFrac = null;
	}

	function nudge(delta: number) {
		onscrub?.(clamp01(progress + delta));
	}

	function onKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowUp':
				nudge(-0.05);
				break;
			case 'ArrowDown':
				nudge(0.05);
				break;
			case 'PageUp':
				nudge(-0.2);
				break;
			case 'PageDown':
				nudge(0.2);
				break;
			case 'Home':
				onscrub?.(0);
				break;
			case 'End':
				onscrub?.(1);
				break;
			default:
				return;
		}
		e.preventDefault();
	}
</script>

<aside class="relative flex w-14 shrink-0 py-3 select-none" aria-label="Jump to date">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={trackEl}
		class="relative flex-1 cursor-ns-resize touch-none border-l"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointerleave={onPointerLeave}
	>
		<!-- Per-month density blips: longer = more photos that month. -->
		{#each marks as m, i (`blip-${i}`)}
			<span
				class="pointer-events-none absolute right-2 h-[3px] -translate-y-1/2 rounded-full bg-muted-foreground"
				style="top: {m.midFrac * 100}%; width: {4 + m.density * 18}px; opacity: {0.5 +
					m.density * 0.5};"
				aria-hidden="true"
			></span>
		{/each}

		<!-- Year labels at each year boundary (click to jump). z-10 + a fully opaque
		     backdrop keep the digits legible above the density blips AND the
		     full-width slider-handle rule below (later in DOM order, so without an
		     explicit z-index it would paint straight through the label — at page
		     load the handle sits at 0%, exactly under the topmost year). The
		     backdrop runs flush to the rail's right edge (right-0 + asymmetric
		     padding keeps the digits where right-1 + px-1 put them) so no sliver
		     of the handle rule peeks out past the label. -->
		{#each yearMarks as m, i (`yr-${i}`)}
			<button
				type="button"
				class="absolute right-0 z-10 -translate-y-1/2 cursor-pointer rounded bg-background py-0.5 pr-2 pl-1 text-[11px] font-semibold text-muted-foreground tabular-nums transition-colors hover:text-foreground"
				style="top: {m.startFrac * 100}%;"
				onclick={() => onscrub?.(m.startFrac)}
			>
				{m.bucket.year}
			</button>
		{/each}

		<!-- Draggable handle (keyboard-accessible slider). -->
		<div
			role="slider"
			tabindex="0"
			aria-label="Scrub timeline by date"
			aria-orientation="vertical"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(handleFrac * 100)}
			aria-valuetext={labelAt(handleFrac)}
			class="pointer-events-none absolute inset-x-0 -translate-y-1/2 focus:outline-none"
			style="top: {handleFrac * 100}%;"
			onkeydown={onKeydown}
		>
			<span class="block h-0.5 w-full rounded-full bg-primary"></span>
		</div>

		<!-- Date bubble shown while hovering / dragging the rail. -->
		{#if bubbleVisible && bubbleLabel}
			<span
				class="pointer-events-none absolute right-full mr-2 -translate-y-1/2 rounded bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background tabular-nums shadow ring-1 ring-border"
				style="top: {clamp01(bubbleFrac) * 100}%;"
			>
				{bubbleLabel}
			</span>
		{/if}
	</div>
</aside>
