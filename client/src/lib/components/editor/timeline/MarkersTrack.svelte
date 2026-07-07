<script lang="ts">
	/**
	 * MarkersTrack — one merged lane of highlight-filter matches.
	 *
	 * Every match across every filter renders as a slim marker colored by its
	 * filter (YouTube-chapter style) — a deliberate single lane so seven preset
	 * filters can't stack seven tracks and starve the player of height. The
	 * tooltip/aria-label disambiguates. Markers are real buttons: Enter seeks,
	 * and the global shortcut map already ignores key events from buttons.
	 */
	import type { TimelineMarker } from '$lib/utils/timeline-geometry';

	interface Props {
		markers: TimelineMarker[];
		pxPerSec: number;
		onseek?: (seconds: number) => void;
	}

	let { markers, pxPerSec, onseek }: Props = $props();
</script>

<div
	class="relative h-6 border-t border-surface-300-700 bg-surface-100-900"
	data-testid="markers-track"
>
	<span
		class="pointer-events-none absolute top-1 left-1 z-10 rounded bg-surface-100-900/80 px-1 text-[9px] font-medium tracking-wide text-surface-500 uppercase"
	>
		Markers
	</span>
	{#each markers as m (m.id)}
		<button
			type="button"
			class="absolute top-0.5 bottom-0.5 w-1.5 rounded-sm transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary-500"
			style="left: {Math.max(0, m.startSeconds * pxPerSec - 3)}px; background-color: {m.color};"
			title={m.title}
			aria-label={m.title}
			onclick={(e) => {
				e.stopPropagation();
				onseek?.(m.startSeconds);
			}}
		></button>
	{/each}
</div>
