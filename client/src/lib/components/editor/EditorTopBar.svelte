<script lang="ts">
	/**
	 * EditorTopBar — back navigation, file identity, and the local-inference job
	 * buttons (Transcribe / Detect audio / Waveform), plus the keyboard-help
	 * trigger. Job buttons keep their status-driven styling: tonal normally,
	 * FILLED when the job failed; labels collapse to icons below `sm`.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatTimecode } from '$lib/utils/timeline-geometry';
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
		onopenShortcuts?: () => void;
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
		onwaveform,
		onopenShortcuts
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

	// Filled when failed, tonal otherwise — the failure state should shout.
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

	const kindBadge = $derived.by(() => {
		const mime = file?.mimeType;
		if (!mime) return null;
		if (mime.startsWith('video/')) return 'Video';
		if (mime.startsWith('audio/')) return 'Audio';
		return null;
	});
</script>

<div class="flex w-full items-center gap-2 sm:gap-3">
	<Button
		iconOnly
		variant="tonal"
		color="surface"
		size="sm"
		title="Back to library"
		aria-label="Back to library"
		onclick={() => onback?.()}
	>
		{#snippet icon()}
			<AppIcon name={ICONS.back} class="size-4" />
		{/snippet}
	</Button>

	<div class="flex min-w-0 flex-1 items-center gap-2">
		<p class="truncate text-lg font-semibold">{file?.name ?? 'Loading…'}</p>
		{#if file?.duration}
			<span class="badge hidden preset-tonal-surface text-xs tabular-nums sm:inline-flex">
				{formatTimecode(file.duration)}
			</span>
		{/if}
		{#if kindBadge}
			<span class="badge hidden preset-tonal-surface text-xs sm:inline-flex">{kindBadge}</span>
		{/if}
	</div>

	{#if playable}
		<Button
			size="sm"
			variant={actionVariant(transcribeFailed)}
			color={colorToken[transcribeButton.color]}
			loading={transcribeLoading}
			disabled={transcribeButton.disabled || transcribing}
			title={transcribeButton.label}
			onclick={() => ontranscribe?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.transcript} class="size-4" />
			{/snippet}
			<span class="hidden sm:inline">{transcribeButton.label}</span>
		</Button>
	{/if}

	{#if canDetectAudio}
		<Button
			size="sm"
			variant={actionVariant(audioDetectFailed)}
			color={colorToken[audioDetectButton.color]}
			loading={audioDetectLoading}
			disabled={audioDetectButton.disabled || audioDetecting}
			title={audioDetectButton.label}
			onclick={() => onaudioDetect?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.audioDetect} class="size-4" />
			{/snippet}
			<span class="hidden sm:inline">{audioDetectButton.label}</span>
		</Button>
	{/if}

	{#if playable}
		<Button
			size="sm"
			variant={actionVariant(waveformFailed)}
			color={colorToken[waveformButton.color]}
			loading={waveformLoading}
			disabled={waveformButton.disabled || waveformGenerating}
			title={waveformButton.label}
			onclick={() => onwaveform?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.waveform} class="size-4" />
			{/snippet}
			<span class="hidden sm:inline">{waveformButton.label}</span>
		</Button>
	{/if}

	<Button
		iconOnly
		size="sm"
		variant="tonal"
		color="surface"
		title="Keyboard shortcuts (?)"
		aria-label="Keyboard shortcuts"
		onclick={() => onopenShortcuts?.()}
	>
		{#snippet icon()}
			<AppIcon name={ICONS.keyboard} class="size-4" />
		{/snippet}
	</Button>
</div>
