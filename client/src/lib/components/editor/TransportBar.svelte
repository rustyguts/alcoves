<script lang="ts">
	/**
	 * TransportBar — the editor's single playback control surface.
	 *
	 * The player itself is chrome-less, so everything lives here: jump ±5s,
	 * ~1-frame stepping, play/pause, a live timecode, playback rate, loop-the-
	 * selected-moment, mute + volume, and fullscreen. Edit operations (new
	 * moment, split, save) deliberately live in the timeline controls instead —
	 * this row is playback only.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatTimecode } from '$lib/utils/timeline-geometry';
	import { JUMP_SECONDS, PLAYBACK_RATES } from '$lib/state/playback.svelte';

	interface Props {
		currentTime: number;
		duration: number;
		paused: boolean;
		rate: number;
		loop: boolean;
		muted: boolean;
		volume: number;
		hasSelection: boolean;
		/** Audio files have no frames to fullscreen. */
		isAudio?: boolean;
		ontoggleplay?: () => void;
		onstepframe?: (frames: -1 | 1) => void;
		onjump?: (seconds: number) => void;
		onsetrate?: (rate: number) => void;
		ontoggleloop?: () => void;
		ontogglemute?: () => void;
		onsetvolume?: (volume: number) => void;
		onfullscreen?: () => void;
	}

	let {
		currentTime,
		duration,
		paused,
		rate,
		loop,
		muted,
		volume,
		hasSelection,
		isAudio = false,
		ontoggleplay,
		onstepframe,
		onjump,
		onsetrate,
		ontoggleloop,
		ontogglemute,
		onsetvolume,
		onfullscreen
	}: Props = $props();

	const forceHours = $derived(duration >= 3600);
	const timecode = $derived(
		`${formatTimecode(currentTime, { forceHours, fractionDigits: 1 })} / ${formatTimecode(
			duration,
			{ forceHours, fractionDigits: 1 }
		)}`
	);

	const volumeOff = $derived(muted || volume === 0);

	function rateLabel(value: number): string {
		return `${value}×`;
	}
</script>

<div
	class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-surface-200-800 bg-surface-100-900 px-2 py-1.5 sm:justify-between"
>
	<!-- Transport cluster -->
	<div class="flex items-center gap-1">
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Back {JUMP_SECONDS}s (J)"
			aria-label="Back {JUMP_SECONDS} seconds"
			onclick={() => onjump?.(-JUMP_SECONDS)}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.jumpBack} class="size-4" />
			{/snippet}
		</Button>
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Step back ~1 frame (,)"
			aria-label="Step back one frame"
			onclick={() => onstepframe?.(-1)}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.chevronLeft} class="size-4" />
			{/snippet}
		</Button>
		<Button
			iconOnly
			size="sm"
			color="primary"
			title={paused ? 'Play (Space)' : 'Pause (Space)'}
			aria-label={paused ? 'Play' : 'Pause'}
			onclick={() => ontoggleplay?.()}
		>
			{#snippet icon()}
				<AppIcon name={paused ? ICONS.play : ICONS.pause} class="size-4" />
			{/snippet}
		</Button>
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Step forward ~1 frame (.)"
			aria-label="Step forward one frame"
			onclick={() => onstepframe?.(1)}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.chevronRight} class="size-4" />
			{/snippet}
		</Button>
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Forward {JUMP_SECONDS}s (L)"
			aria-label="Forward {JUMP_SECONDS} seconds"
			onclick={() => onjump?.(JUMP_SECONDS)}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.jumpForward} class="size-4" />
			{/snippet}
		</Button>
	</div>

	<!-- Timecode -->
	<span class="px-1 text-xs text-surface-600-400 tabular-nums" data-testid="transport-timecode">
		{timecode}
	</span>

	<!-- Rate · loop · volume · fullscreen -->
	<div class="flex items-center gap-1">
		<label class="flex items-center gap-1 text-[11px] text-surface-600-400">
			<span class="sr-only">Playback rate</span>
			<select
				class="select w-auto rounded border border-surface-200-800 px-1 py-0.5 text-xs tabular-nums"
				value={rate}
				aria-label="Playback rate"
				onchange={(e) => onsetrate?.(Number(e.currentTarget.value))}
			>
				{#each PLAYBACK_RATES as r (r)}
					<option value={r}>{rateLabel(r)}</option>
				{/each}
			</select>
		</label>

		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color={loop ? 'primary' : 'surface'}
			disabled={!hasSelection}
			aria-pressed={loop}
			title="Loop selected moment (R)"
			aria-label="Loop selected moment"
			onclick={() => ontoggleloop?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.loop} class="size-4" />
			{/snippet}
		</Button>

		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title={volumeOff ? 'Unmute' : 'Mute'}
			aria-label={volumeOff ? 'Unmute' : 'Mute'}
			onclick={() => ontogglemute?.()}
		>
			{#snippet icon()}
				<AppIcon name={volumeOff ? ICONS.volumeOff : ICONS.volumeOn} class="size-4" />
			{/snippet}
		</Button>

		<input
			type="range"
			min="0"
			max="1"
			step="0.05"
			value={volume}
			aria-label="Volume"
			class="hidden h-1.5 w-20 cursor-pointer accent-primary-500 sm:inline-block"
			oninput={(e) => onsetvolume?.(Number(e.currentTarget.value))}
		/>

		{#if !isAudio}
			<Button
				iconOnly
				size="sm"
				variant="tonal"
				color="surface"
				title="Fullscreen"
				aria-label="Fullscreen"
				onclick={() => onfullscreen?.()}
			>
				{#snippet icon()}
					<AppIcon name={ICONS.fullscreen} class="size-4" />
				{/snippet}
			</Button>
		{/if}
	</div>
</div>
