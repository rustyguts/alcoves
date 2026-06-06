<!--
	Justified (Google-Photos-style) media gallery. Lays each group's items into
	rows that fill the available width edge-to-edge at their native aspect ratio.
	Purely presentational — the parent owns data loading, grouping, and what
	`onselect` does. Tracks its own width via a ResizeObserver so rows reflow on
	resize.

	Two modes:
	  - default: one justified block per group, with a sticky group heading and
	    optional large section divider (used by global search). The trailing row
	    of each group is left ragged (not stretched).
	  - `continuous`: one justified block per group (day), each under a real
	    heading band, with every group's trailing row stretched to full width so
	    the grid fills the container edge-to-edge — Google-Photos style. The
	    section carries `data-group-key` as a scroll anchor (used by the timeline).
-->
<script lang="ts" generics="T">
	import { ICONS } from '$lib/utils/icons';
	import { justifiedLayout, type JustifiedRow } from '$lib/utils/justified-layout';
	import type { GalleryGroup, GalleryItem } from '$lib/utils/gallery-types';
	import { getMimeIcon } from '$lib/utils/mime-icons';
	import AlcovesImage from '$lib/components/ui/AlcovesImage.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		groups: GalleryGroup<T>[];
		gap?: number;
		targetRowHeight?: number;
		maxRowHeight?: number;
		continuous?: boolean;
		onselect?: (item: T) => void;
	}

	let {
		groups,
		gap = 3,
		targetRowHeight = 200,
		maxRowHeight = 320,
		continuous = false,
		onselect
	}: Props = $props();

	let rootEl = $state<HTMLElement | null>(null);
	let width = $state(0);

	$effect(() => {
		if (!rootEl) return;
		width = rootEl.clientWidth;
		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) width = entry.contentRect.width;
		});
		resizeObserver.observe(rootEl);
		return () => resizeObserver.disconnect();
	});

	interface LaidOutGroup {
		group: GalleryGroup<T>;
		rows: JustifiedRow<GalleryItem<T>>[];
	}

	// Justify a single group's items at the current container width. `stretchLastRow`
	// fills the trailing row edge-to-edge (continuous/timeline mode) versus leaving
	// it ragged (default/search mode).
	function layoutGroup(group: GalleryGroup<T>, stretchLastRow: boolean): LaidOutGroup {
		return {
			group,
			rows: justifiedLayout(group.items, (i) => i.aspect, {
				containerWidth: width,
				targetRowHeight,
				gap,
				maxRowHeight,
				stretchLastRow
			})
		};
	}

	// Default mode: one justified block per group (ragged trailing row, sticky heading).
	const laidOut = $derived<LaidOutGroup[]>(
		continuous ? [] : groups.map((g) => layoutGroup(g, false))
	);

	// Continuous (timeline) mode: one justified block per DAY, each day's trailing
	// row stretched to full width, with a real heading band above each day.
	const laidOutContinuous = $derived<LaidOutGroup[]>(
		continuous ? groups.map((g) => layoutGroup(g, true)) : []
	);
</script>

<div bind:this={rootEl}>
	{#if continuous}
		<!-- Continuous (timeline): one section per day, full-width rows, heading band. -->
		{#each laidOutContinuous as entry (entry.group.key)}
			<section data-group-key={entry.group.key} class="mb-6">
				<div class="flex items-baseline gap-2 px-1 pt-5 pb-2 first:pt-1">
					<h3 class="text-default text-sm font-semibold">{entry.group.heading}</h3>
					<span class="text-dimmed text-xs tabular-nums">{entry.group.count}</span>
				</div>

				<div class="flex flex-col" style:gap="{gap}px">
					{#each entry.rows as row, ri (ri)}
						<div class="flex" style:gap="{gap}px">
							{#each row.boxes as box (box.item.id)}
								<button
									type="button"
									class="group bg-elevated focus-visible:ring-primary relative cursor-pointer overflow-hidden rounded-[2px] focus:outline-none focus-visible:z-10 focus-visible:ring-2"
									style:width="{box.width}px"
									style:height="{box.height}px"
									title={box.item.name}
									onclick={() => onselect?.(box.item.raw)}
								>
									{#if box.item.thumbnailFileId}
										<AlcovesImage
											libraryId={box.item.libraryId}
											fileId={box.item.thumbnailFileId}
											sourceWidth={box.item.sourceWidth}
											sourceHeight={box.item.sourceHeight}
											alt={box.item.name}
											variant="timeline"
											class="h-full w-full object-cover transition duration-200 group-hover:brightness-110"
										/>
									{:else}
										<span class="text-dimmed flex h-full w-full items-center justify-center">
											<AppIcon name={getMimeIcon(box.item.mime)} class="size-7" />
										</span>
									{/if}

									<!-- Video duration (no play icon) -->
									{#if box.item.isVideo && box.item.durationLabel}
										<span
											class="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white tabular-nums"
										>
											{box.item.durationLabel}
										</span>
									{/if}
								</button>
							{/each}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{:else}
		<!-- Default: one justified block per group with sticky headings. -->
		{#each laidOut as entry (entry.group.key)}
			<!-- Optional large section divider (e.g. a month) -->
			{#if entry.group.sectionLabel}
				<h2 class="text-default pt-6 pb-1 text-2xl font-semibold tracking-tight first:pt-3">
					{entry.group.sectionLabel}
				</h2>
			{/if}

			<section class="mb-5">
				<h3 class="bg-default/85 sticky top-0 z-10 flex items-baseline gap-2 py-1.5 backdrop-blur">
					<span class="text-default truncate text-sm font-medium">{entry.group.heading}</span>
					<span class="text-dimmed shrink-0 text-xs">{entry.group.count}</span>
				</h3>

				<div class="mt-1.5 flex flex-col" style:gap="{gap}px">
					{#each entry.rows as row, ri (ri)}
						<div class="flex" style:gap="{gap}px">
							{#each row.boxes as box (box.item.id)}
								<button
									type="button"
									class="group bg-elevated focus-visible:ring-primary relative cursor-pointer overflow-hidden rounded-[2px] focus:outline-none focus-visible:z-10 focus-visible:ring-2"
									style:width="{box.width}px"
									style:height="{box.height}px"
									title={box.item.name}
									onclick={() => onselect?.(box.item.raw)}
								>
									{#if box.item.thumbnailFileId}
										<AlcovesImage
											libraryId={box.item.libraryId}
											fileId={box.item.thumbnailFileId}
											sourceWidth={box.item.sourceWidth}
											sourceHeight={box.item.sourceHeight}
											alt={box.item.name}
											variant="timeline"
											class="h-full w-full object-cover transition duration-200 group-hover:brightness-110"
										/>
									{:else}
										<span class="text-dimmed flex h-full w-full items-center justify-center">
											<AppIcon name={getMimeIcon(box.item.mime)} class="size-7" />
										</span>
									{/if}

									<!-- Matched-label / metadata badge -->
									{#if box.item.badge}
										<span
											class="absolute top-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
										>
											{box.item.badge}
										</span>
									{/if}

									<!-- Video affordance: duration when known, else a play badge so a
									     video is still distinguishable (search results carry no duration). -->
									{#if box.item.isVideo}
										<span
											class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
										></span>
									{/if}
									{#if box.item.isVideo && box.item.durationLabel}
										<span
											class="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white tabular-nums"
										>
											{box.item.durationLabel}
										</span>
									{:else if box.item.isVideo}
										<span
											class="absolute right-1.5 bottom-1.5 rounded bg-black/60 p-0.5 text-white"
										>
											<AppIcon name={ICONS.play} class="size-3" />
										</span>
									{/if}
								</button>
							{/each}
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>
