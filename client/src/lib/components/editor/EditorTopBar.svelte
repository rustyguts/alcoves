<script lang="ts">
	/**
	 * EditorTopBar — back navigation, file identity, and the local-inference job
	 * buttons (Transcribe / Detect audio / Waveform), plus the keyboard-help
	 * trigger. Job buttons keep their status-driven tint: neutral/tonal
	 * normally, destructive when the job failed; labels collapse to icons below
	 * `sm`. Icon-only controls keep native `title` + `aria-label` (this bar sits
	 * beside the equally dense TransportBar/TimelineControls — see the note
	 * there on skipping the Tooltip primitive for this high-frequency chrome).
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ICONS } from '$lib/utils/icons';
	import { formatTimecode } from '$lib/utils/timeline-geometry';
	import type { LibraryFile } from '$lib/types/api';
	import type { JobStatusButton } from '$lib/utils/job-status-button';

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

	// Job status tint: a soft color chip when idle/queued, the destructive
	// treatment when the job failed (that state should shout).
	const TINT: Record<'primary' | 'warning', string> = {
		primary: 'bg-primary/10 text-primary hover:bg-primary/20',
		warning: 'bg-warning/10 text-warning hover:bg-warning/20'
	};

	function actionClass(color: JobStatusButton['color'], failed: boolean): string {
		if (failed) return '';
		if (color === 'primary' || color === 'warning') return TINT[color];
		return '';
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
		variant="secondary"
		size="icon-sm"
		title="Back to library"
		aria-label="Back to library"
		onclick={() => onback?.()}
	>
		<AppIcon name={ICONS.back} class="size-4" />
	</Button>

	<div class="flex min-w-0 flex-1 items-center gap-2">
		<p class="truncate text-lg font-semibold">{file?.name ?? 'Loading…'}</p>
		{#if file?.duration}
			<Badge variant="secondary" class="hidden text-xs tabular-nums sm:inline-flex">
				{formatTimecode(file.duration)}
			</Badge>
		{/if}
		{#if kindBadge}
			<Badge variant="secondary" class="hidden text-xs sm:inline-flex">{kindBadge}</Badge>
		{/if}
	</div>

	{#if playable}
		<Button
			size="sm"
			variant={transcribeFailed ? 'destructive' : 'secondary'}
			class={actionClass(transcribeButton.color, transcribeFailed)}
			disabled={transcribeButton.disabled || transcribing || transcribeLoading}
			aria-busy={transcribeLoading || undefined}
			title={transcribeButton.label}
			onclick={() => ontranscribe?.()}
		>
			{#if transcribeLoading}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.transcript} class="size-4" />
			{/if}
			<span class="hidden sm:inline">{transcribeButton.label}</span>
		</Button>
	{/if}

	{#if canDetectAudio}
		<Button
			size="sm"
			variant={audioDetectFailed ? 'destructive' : 'secondary'}
			class={actionClass(audioDetectButton.color, audioDetectFailed)}
			disabled={audioDetectButton.disabled || audioDetecting || audioDetectLoading}
			aria-busy={audioDetectLoading || undefined}
			title={audioDetectButton.label}
			onclick={() => onaudioDetect?.()}
		>
			{#if audioDetectLoading}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.audioDetect} class="size-4" />
			{/if}
			<span class="hidden sm:inline">{audioDetectButton.label}</span>
		</Button>
	{/if}

	{#if playable}
		<Button
			size="sm"
			variant={waveformFailed ? 'destructive' : 'secondary'}
			class={actionClass(waveformButton.color, waveformFailed)}
			disabled={waveformButton.disabled || waveformGenerating || waveformLoading}
			aria-busy={waveformLoading || undefined}
			title={waveformButton.label}
			onclick={() => onwaveform?.()}
		>
			{#if waveformLoading}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.waveform} class="size-4" />
			{/if}
			<span class="hidden sm:inline">{waveformButton.label}</span>
		</Button>
	{/if}

	<Button
		variant="secondary"
		size="icon-sm"
		title="Keyboard shortcuts (?)"
		aria-label="Keyboard shortcuts"
		onclick={() => onopenShortcuts?.()}
	>
		<AppIcon name={ICONS.keyboard} class="size-4" />
	</Button>
</div>
