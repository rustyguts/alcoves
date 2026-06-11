<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryFile } from '$lib/types/api';
	import type { JobButtonColor, JobStatusButton } from '$lib/utils/job-status-button';

	type ButtonColor = 'primary' | 'surface' | 'error' | 'warning' | 'success';
	type ButtonVariant = 'filled' | 'tonal';

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

	// JobButtonColor -> Button color token. `neutral` has no preset of its own;
	// it maps onto the surface palette.
	const colorToken: Record<JobButtonColor, ButtonColor> = {
		primary: 'primary',
		neutral: 'surface',
		warning: 'warning',
		error: 'error'
	};

	// The Vue original used `solid` (filled) for a failed job and `soft` (tonal)
	// otherwise. Mirror that here: filled when failed, tonal otherwise. The Button
	// renders the same `preset-filled-{color}-500` / `preset-tonal-{color}` tokens.
	function actionVariant(failed: boolean): ButtonVariant {
		return failed ? 'filled' : 'tonal';
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
	<Button variant="tonal" color="surface" size="sm" onclick={() => onback?.()}>
		{#snippet icon()}
			<AppIcon name={ICONS.back} class="size-4" />
		{/snippet}
		Back
	</Button>

	<div class="min-w-0 flex-1">
		<p class="truncate text-lg font-semibold">{file?.name ?? 'Loading…'}</p>
	</div>

	{#if playable}
		<Button
			size="sm"
			variant={actionVariant(transcribeFailed)}
			color={colorToken[transcribeButton.color]}
			loading={transcribeLoading}
			disabled={transcribeButton.disabled || transcribing}
			onclick={() => ontranscribe?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.transcript} class="size-4" />
			{/snippet}
			{transcribeButton.label}
		</Button>
	{/if}

	{#if canDetectAudio}
		<Button
			size="sm"
			variant={actionVariant(audioDetectFailed)}
			color={colorToken[audioDetectButton.color]}
			loading={audioDetectLoading}
			disabled={audioDetectButton.disabled || audioDetecting}
			onclick={() => onaudioDetect?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.audioDetect} class="size-4" />
			{/snippet}
			{audioDetectButton.label}
		</Button>
	{/if}

	{#if playable}
		<Button
			size="sm"
			variant={actionVariant(waveformFailed)}
			color={colorToken[waveformButton.color]}
			loading={waveformLoading}
			disabled={waveformButton.disabled || waveformGenerating}
			onclick={() => onwaveform?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.waveform} class="size-4" />
			{/snippet}
			{waveformButton.label}
		</Button>
	{/if}
</div>
