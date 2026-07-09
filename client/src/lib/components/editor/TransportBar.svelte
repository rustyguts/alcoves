<script lang="ts">
	/**
	 * TransportBar — the editor's single playback control surface.
	 *
	 * The player itself is chrome-less, so everything lives here: jump ±5s,
	 * ~1-frame stepping, play/pause, a live timecode, playback rate, loop-the-
	 * selected-moment, mute + volume, and fullscreen. Edit operations (new
	 * moment, split, save) deliberately live in the timeline controls instead —
	 * this row is playback only.
	 *
	 * Every control here is a high-frequency, icon-only affordance in the
	 * tightest strip of the editor, so hints stay native `title` (+ `aria-label`
	 * for a11y) rather than the shadcn Tooltip primitive — avoids a portal-open
	 * on the single most-clicked control (Play) and keeps this dense toolbar
	 * fast. The playback-rate picker stays a native `<select>` for the same
	 * reason (compact, keyboard-first, zero portal overhead).
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
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
	class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl bg-muted/50 px-2 py-1.5 sm:justify-between"
>
	<!-- Transport cluster -->
	<div class="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon-sm"
			title="Back {JUMP_SECONDS}s (J)"
			aria-label="Back {JUMP_SECONDS} seconds"
			onclick={() => onjump?.(-JUMP_SECONDS)}
		>
			<AppIcon name={ICONS.jumpBack} class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title="Step back ~1 frame (,)"
			aria-label="Step back one frame"
			onclick={() => onstepframe?.(-1)}
		>
			<AppIcon name={ICONS.chevronLeft} class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			title={paused ? 'Play (Space)' : 'Pause (Space)'}
			aria-label={paused ? 'Play' : 'Pause'}
			onclick={() => ontoggleplay?.()}
		>
			<AppIcon name={paused ? ICONS.play : ICONS.pause} class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title="Step forward ~1 frame (.)"
			aria-label="Step forward one frame"
			onclick={() => onstepframe?.(1)}
		>
			<AppIcon name={ICONS.chevronRight} class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			title="Forward {JUMP_SECONDS}s (L)"
			aria-label="Forward {JUMP_SECONDS} seconds"
			onclick={() => onjump?.(JUMP_SECONDS)}
		>
			<AppIcon name={ICONS.jumpForward} class="size-4" />
		</Button>
	</div>

	<!-- Timecode -->
	<span class="px-1 text-xs text-muted-foreground tabular-nums" data-testid="transport-timecode">
		{timecode}
	</span>

	<!-- Rate · loop · volume · fullscreen -->
	<div class="flex items-center gap-1">
		<label class="flex items-center gap-1 text-[11px] text-muted-foreground">
			<span class="sr-only">Playback rate</span>
			<select
				class="w-auto rounded border bg-transparent px-1 py-0.5 text-xs tabular-nums"
				value={rate}
				aria-label="Playback rate"
				onchange={(e) => onsetrate?.(Number(e.currentTarget.value))}
			>
				{#each PLAYBACK_RATES as r (r)}
					<option value={r}>{rateLabel(r)}</option>
				{/each}
			</select>
		</label>

		<Toggle
			size="sm"
			pressed={loop}
			onPressedChange={() => ontoggleloop?.()}
			disabled={!hasSelection}
			title="Loop selected moment (R)"
			aria-label="Loop selected moment"
			class="size-8 p-0 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
		>
			<AppIcon name={ICONS.loop} class="size-4" />
		</Toggle>

		<Button
			variant="ghost"
			size="icon-sm"
			title={volumeOff ? 'Unmute' : 'Mute'}
			aria-label={volumeOff ? 'Unmute' : 'Mute'}
			onclick={() => ontogglemute?.()}
		>
			<AppIcon name={volumeOff ? ICONS.volumeOff : ICONS.volumeOn} class="size-4" />
		</Button>

		<input
			type="range"
			min="0"
			max="1"
			step="0.05"
			value={volume}
			aria-label="Volume"
			class="hidden h-1.5 w-20 cursor-pointer accent-primary sm:inline-block"
			oninput={(e) => onsetvolume?.(Number(e.currentTarget.value))}
		/>

		{#if !isAudio}
			<Button
				variant="ghost"
				size="icon-sm"
				title="Fullscreen"
				aria-label="Fullscreen"
				onclick={() => onfullscreen?.()}
			>
				<AppIcon name={ICONS.fullscreen} class="size-4" />
			</Button>
		{/if}
	</div>
</div>
