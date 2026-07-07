<script lang="ts">
	/**
	 * AudioDetectionsPanel — the Audio inspector tab.
	 *
	 * Detections are grouped into label buckets (sorted by best score). Each
	 * bucket renders a compact timeline strip of its windows; clicking a window
	 * bar — or a per-window chip when the bucket is expanded — fires `onseek`.
	 *
	 * Existing detections always render. When there are none, the empty state
	 * offers the local detection job — gated on a completed transcript, which
	 * the backend requires before audio detection can run.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatDuration } from '$lib/utils/format-duration';
	import type { AudioDetection } from '$lib/types/api';
	import type { JobStatusButton } from '$lib/utils/job-status-button';

	interface Props {
		detections: AudioDetection[];
		duration: number;
		onseek?: (seconds: number) => void;
		/** Detect-audio job button state for the empty-state CTA. */
		jobButton?: JobStatusButton | null;
		/** Audio detection requires a completed transcript. */
		canDetectAudio?: boolean;
		onrunjob?: () => void;
	}

	let {
		detections,
		duration,
		onseek,
		jobButton = null,
		canDetectAudio = false,
		onrunjob
	}: Props = $props();

	interface LabelBucket {
		label: string;
		classIndex: number;
		bestScore: number;
		count: number;
		windows: AudioDetection[];
	}

	const buckets = $derived.by<LabelBucket[]>(() => {
		const byLabel = new Map<string, LabelBucket>();
		for (const d of detections) {
			const b = byLabel.get(d.label);
			if (b) {
				b.count++;
				b.windows.push(d);
				if (d.score > b.bestScore) b.bestScore = d.score;
			} else {
				byLabel.set(d.label, {
					label: d.label,
					classIndex: d.classIndex,
					bestScore: d.score,
					count: 1,
					windows: [d]
				});
			}
		}
		return [...byLabel.values()].sort((a, b) => b.bestScore - a.bestScore);
	});

	let expanded = $state<Set<string>>(new Set());

	function toggleExpand(label: string) {
		const next = new Set(expanded);
		if (next.has(label)) next.delete(label);
		else next.add(label);
		expanded = next;
	}

	function formatTime(seconds: number): string {
		return formatDuration(seconds) ?? '0:00';
	}

	function barStyle(window: AudioDetection): string {
		if (duration <= 0) return 'left: 0%; width: 100%;';
		const left = Math.max(0, (window.startSeconds / duration) * 100);
		const width = Math.max(0.5, ((window.endSeconds - window.startSeconds) / duration) * 100);
		return `left: ${left}%; width: ${width}%;`;
	}
</script>

{#if detections.length === 0}
	<EmptyState
		icon={ICONS.audioDetect}
		title="No audio events yet"
		description={canDetectAudio
			? 'Detect laughter, applause, music and hundreds of other sounds — locally, on this instance.'
			: 'Audio detection needs a completed transcript first. Run Transcribe, then come back.'}
	>
		{#snippet actions()}
			{#if onrunjob}
				<Button
					size="sm"
					variant="tonal"
					color="primary"
					loading={jobButton?.loading ?? false}
					disabled={!canDetectAudio || (jobButton?.disabled ?? false)}
					onclick={() => onrunjob?.()}
				>
					{#snippet icon()}
						<AppIcon name={ICONS.audioDetect} class="size-4" />
					{/snippet}
					{jobButton?.label ?? 'Detect audio'}
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else}
	<div class="flex flex-col" data-testid="audio-detections-panel">
		<div class="flex items-center justify-between gap-2 border-b border-surface-200-800 pb-2">
			<span class="badge preset-tonal-surface text-xs">{buckets.length} labels</span>
			<p class="text-[11px] text-surface-600-400">Click a bar to jump to that moment</p>
		</div>

		<ul class="flex flex-col divide-y divide-surface-200-800">
			{#each buckets as b (b.label)}
				<li class="py-2">
					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 text-left"
						onclick={() => toggleExpand(b.label)}
					>
						<div class="flex min-w-0 flex-1 items-center gap-2">
							<AppIcon
								name={expanded.has(b.label) ? ICONS.chevronDown : ICONS.chevronRight}
								class="size-3.5 shrink-0 text-surface-600-400"
							/>
							<span class="truncate text-sm font-medium">{b.label}</span>
							<span
								class="badge shrink-0 text-xs {b.bestScore >= 0.7
									? 'preset-tonal-success'
									: b.bestScore >= 0.4
										? 'preset-tonal-primary'
										: b.bestScore >= 0.2
											? 'preset-tonal-warning'
											: 'preset-tonal-surface'}"
							>
								{(b.bestScore * 100).toFixed(0)}%
							</span>
							<span class="shrink-0 text-[11px] text-surface-600-400 tabular-nums">
								{b.count}×
							</span>
						</div>
					</button>

					<!-- Timeline strip -->
					<div class="relative mt-1.5 h-2 overflow-hidden rounded-full bg-surface-200-800/70">
						{#each b.windows as w (w.id)}
							<button
								type="button"
								class="absolute top-0 bottom-0 rounded-sm transition-opacity hover:opacity-90 {w.score >=
								0.7
									? 'bg-success-500'
									: w.score >= 0.4
										? 'bg-primary-500'
										: w.score >= 0.2
											? 'bg-warning-500'
											: 'bg-surface-500'}"
								style="{barStyle(w)} opacity: {0.4 + 0.6 * w.score};"
								title={`${w.label} · ${(w.score * 100).toFixed(0)}% at ${formatTime(w.startSeconds)}`}
								onclick={(e) => {
									e.stopPropagation();
									onseek?.(w.startSeconds);
								}}
								aria-label={`${w.label} at ${formatTime(w.startSeconds)}`}
							></button>
						{/each}
					</div>

					{#if expanded.has(b.label)}
						<ul class="mt-2 flex flex-wrap gap-1 pl-5">
							{#each b.windows as w (w.id)}
								<li>
									<button
										type="button"
										class="flex items-center gap-1 rounded-md border border-surface-200-800 px-2 py-0.5 text-[11px] tabular-nums hover:border-primary-500 hover:bg-surface-200-800"
										onclick={() => onseek?.(w.startSeconds)}
									>
										<AppIcon name={ICONS.play} class="size-2.5" />
										{formatTime(w.startSeconds)}
										<span class="text-surface-600-400"> · {(w.score * 100).toFixed(0)}% </span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}
