<script lang="ts">
	/**
	 * TimelineControls — the row above the tracks: timecode + zoom readouts,
	 * zoom in/out/fit, snapping toggle, and the edit actions (split at playhead,
	 * new moment, batch save). Playback controls live in the TransportBar.
	 *
	 * Icon-only controls keep native `title` + `aria-label` (dense, high-
	 * frequency toolbar — see the note on TransportBar for why the Tooltip
	 * primitive is skipped here).
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import { ICONS } from '$lib/utils/icons';
	import { formatTimecode } from '$lib/utils/timeline-geometry';

	interface Props {
		currentTime: number;
		duration: number;
		zoom: number;
		snapping: boolean;
		cansplit: boolean;
		pendingCount: number;
		saving?: boolean;
		onzoomin?: () => void;
		onzoomout?: () => void;
		onzoomfit?: () => void;
		ontogglesnap?: () => void;
		onsplit?: () => void;
		oncreate?: () => void;
		onsave?: () => void;
	}

	let {
		currentTime,
		duration,
		zoom,
		snapping,
		cansplit,
		pendingCount,
		saving = false,
		onzoomin,
		onzoomout,
		onzoomfit,
		ontogglesnap,
		onsplit,
		oncreate,
		onsave
	}: Props = $props();

	const forceHours = $derived(duration >= 3600);
	const hasPending = $derived(pendingCount > 0);
</script>

<div class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
	<span class="text-xs text-muted-foreground tabular-nums">
		{formatTimecode(currentTime, { forceHours })} / {formatTimecode(duration, { forceHours })}
	</span>
	<span class="text-xs text-muted-foreground tabular-nums">{(zoom * 100).toFixed(0)}%</span>

	<div class="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon-sm"
			title="Zoom out (X)"
			aria-label="Zoom out"
			onclick={() => onzoomout?.()}
		>
			<AppIcon name={ICONS.zoomOut} class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title="Zoom in (Z)"
			aria-label="Zoom in"
			onclick={() => onzoomin?.()}
		>
			<AppIcon name={ICONS.zoomIn} class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title="Zoom to fit (F)"
			aria-label="Zoom to fit"
			onclick={() => onzoomfit?.()}
		>
			<AppIcon name={ICONS.zoomFit} class="size-4" />
		</Button>
		<Toggle
			size="sm"
			pressed={snapping}
			onPressedChange={() => ontogglesnap?.()}
			title="Snap to edges & playhead (G)"
			aria-label="Toggle snapping"
			class="size-8 p-0 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
		>
			<AppIcon name={ICONS.snap} class="size-4" />
		</Toggle>
	</div>

	<div class="flex-1"></div>

	<div class="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!cansplit}
			title="Split at playhead (S)"
			aria-label="Split at playhead"
			onclick={() => onsplit?.()}
		>
			<AppIcon name={ICONS.split} class="size-4" />
		</Button>
		<Button size="sm" onclick={() => oncreate?.()}>
			<AppIcon name={ICONS.plus} class="size-4" />
			New moment
		</Button>
		<Button
			size="sm"
			variant="secondary"
			class={hasPending ? 'bg-warning text-warning-foreground hover:bg-warning/90' : ''}
			disabled={!hasPending || saving}
			aria-busy={saving || undefined}
			onclick={() => onsave?.()}
		>
			{#if saving}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.save} class="size-4" />
			{/if}
			Save changes{hasPending ? ` (${pendingCount})` : ''}
		</Button>
	</div>
</div>
