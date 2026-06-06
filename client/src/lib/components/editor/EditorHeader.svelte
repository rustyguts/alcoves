<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryFile } from '$lib/types/api';
	import type { JobButtonColor, JobStatusButton } from '$lib/utils/job-status-button';

	interface Props {
		file: LibraryFile | null | undefined;
		transcribing: boolean;
		transcribeButton: JobStatusButton;
		audioDetecting: boolean;
		audioDetectButton: JobStatusButton;
		canDetectAudio: boolean;
		waveformGenerating: boolean;
		waveformButton: JobStatusButton;
		onback?: () => void;
		ontranscribe?: () => void;
		onaudioDetect?: () => void;
		onwaveform?: () => void;
	}

	let {
		file,
		transcribing,
		transcribeButton,
		audioDetecting,
		audioDetectButton,
		canDetectAudio,
		waveformGenerating,
		waveformButton,
		onback,
		ontranscribe,
		onaudioDetect,
		onwaveform
	}: Props = $props();

	function isPlayable(mimeType: string | undefined | null): boolean {
		return !!mimeType && (mimeType.startsWith('video/') || mimeType.startsWith('audio/'));
	}

	// JobButtonColor -> Skeleton color token. `neutral` has no preset of its own;
	// it maps onto the surface palette.
	const colorToken: Record<JobButtonColor, string> = {
		primary: 'primary',
		neutral: 'surface',
		warning: 'warning',
		error: 'error'
	};

	// The Vue original used `solid` (filled) for a failed job and `soft` (tonal)
	// otherwise. Mirror that here with Skeleton presets.
	function actionPreset(btn: JobStatusButton, failed: boolean): string {
		const token = colorToken[btn.color];
		return failed ? `preset-filled-${token}-500` : `preset-tonal-${token}`;
	}

	const playable = $derived(!!file && isPlayable(file.mimeType));
	const transcribeFailed = $derived(file?.transcribeStatus === 'failed');
	const audioDetectFailed = $derived(file?.audioDetectStatus === 'failed');
	const waveformFailed = $derived(file?.waveformStatus === 'failed');

	const transcribeLoading = $derived(transcribeButton.loading || transcribing);
	const audioDetectLoading = $derived(audioDetectButton.loading || audioDetecting);
	const waveformLoading = $derived(waveformButton.loading || waveformGenerating);
</script>

<div class="flex w-full items-center gap-3">
	<button type="button" class="btn preset-tonal-surface btn-sm" onclick={() => onback?.()}>
		<AppIcon name={ICONS.back} class="size-4" />
		Back
	</button>

	<div class="min-w-0 flex-1">
		<p class="truncate text-lg font-semibold">{file?.name ?? 'Loading…'}</p>
	</div>

	{#if playable}
		<button
			type="button"
			class="btn btn-sm {actionPreset(transcribeButton, transcribeFailed)}"
			disabled={transcribeButton.disabled || transcribing}
			onclick={() => ontranscribe?.()}
		>
			{#if transcribeLoading}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.transcript} class="size-4" />
			{/if}
			{transcribeButton.label}
		</button>
	{/if}

	{#if canDetectAudio}
		<button
			type="button"
			class="btn btn-sm {actionPreset(audioDetectButton, audioDetectFailed)}"
			disabled={audioDetectButton.disabled || audioDetecting}
			onclick={() => onaudioDetect?.()}
		>
			{#if audioDetectLoading}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.audioDetect} class="size-4" />
			{/if}
			{audioDetectButton.label}
		</button>
	{/if}

	{#if playable}
		<button
			type="button"
			class="btn btn-sm {actionPreset(waveformButton, waveformFailed)}"
			disabled={waveformButton.disabled || waveformGenerating}
			onclick={() => onwaveform?.()}
		>
			{#if waveformLoading}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.waveform} class="size-4" />
			{/if}
			{waveformButton.label}
		</button>
	{/if}
</div>
