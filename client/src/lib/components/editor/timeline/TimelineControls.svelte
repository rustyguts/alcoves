<script lang="ts">
	/**
	 * TimelineControls — the row above the tracks: timecode + zoom readouts,
	 * zoom in/out/fit, snapping toggle, and the edit actions (split at playhead,
	 * new moment, batch save). Playback controls live in the TransportBar.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
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
	<span class="text-xs text-surface-600-400 tabular-nums">
		{formatTimecode(currentTime, { forceHours })} / {formatTimecode(duration, { forceHours })}
	</span>
	<span class="text-xs text-surface-600-400 tabular-nums">{(zoom * 100).toFixed(0)}%</span>

	<div class="flex items-center gap-1">
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Zoom out (X)"
			aria-label="Zoom out"
			onclick={() => onzoomout?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.zoomOut} class="size-4" />
			{/snippet}
		</Button>
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Zoom in (Z)"
			aria-label="Zoom in"
			onclick={() => onzoomin?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.zoomIn} class="size-4" />
			{/snippet}
		</Button>
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Zoom to fit (F)"
			aria-label="Zoom to fit"
			onclick={() => onzoomfit?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.zoomFit} class="size-4" />
			{/snippet}
		</Button>
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color={snapping ? 'primary' : 'surface'}
			aria-pressed={snapping}
			title="Snap to edges & playhead (G)"
			aria-label="Toggle snapping"
			onclick={() => ontogglesnap?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.snap} class="size-4" />
			{/snippet}
		</Button>
	</div>

	<div class="flex-1"></div>

	<div class="flex items-center gap-1">
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			disabled={!cansplit}
			title="Split at playhead (S)"
			aria-label="Split at playhead"
			onclick={() => onsplit?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.split} class="size-4" />
			{/snippet}
		</Button>
		<Button size="sm" onclick={() => oncreate?.()}>
			{#snippet icon()}
				<AppIcon name={ICONS.plus} class="size-4" />
			{/snippet}
			New moment
		</Button>
		<Button
			size="sm"
			variant={hasPending ? 'filled' : 'tonal'}
			color={hasPending ? 'warning' : 'surface'}
			loading={saving}
			disabled={!hasPending || saving}
			onclick={() => onsave?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.save} class="size-4" />
			{/snippet}
			Save changes{hasPending ? ` (${pendingCount})` : ''}
		</Button>
	</div>
</div>
