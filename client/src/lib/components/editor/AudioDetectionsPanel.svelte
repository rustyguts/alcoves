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
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatDuration } from '$lib/utils/format-duration';
	import { cn } from '$lib/utils';
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

	function scoreBadgeClass(score: number): string {
		if (score >= 0.7) return 'bg-success/10 text-success';
		if (score >= 0.4) return 'bg-primary/10 text-primary';
		if (score >= 0.2) return 'bg-warning/10 text-warning';
		return '';
	}

	function scoreBarClass(score: number): string {
		if (score >= 0.7) return 'bg-success';
		if (score >= 0.4) return 'bg-primary';
		if (score >= 0.2) return 'bg-warning';
		return 'bg-muted-foreground';
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
					variant="secondary"
					disabled={!canDetectAudio ||
						(jobButton?.disabled ?? false) ||
						(jobButton?.loading ?? false)}
					aria-busy={jobButton?.loading || undefined}
					onclick={() => onrunjob?.()}
				>
					{#if jobButton?.loading}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.audioDetect} class="size-4" />
					{/if}
					{jobButton?.label ?? 'Detect audio'}
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else}
	<div class="flex flex-col gap-2" data-testid="audio-detections-panel">
		<div class="flex items-center justify-between gap-2">
			<Badge variant="secondary">{buckets.length} labels</Badge>
			<p class="text-[11px] text-muted-foreground">Click a bar to jump to that moment</p>
		</div>

		<ul class="flex flex-col gap-1">
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
								class="size-3.5 shrink-0 text-muted-foreground"
							/>
							<span class="truncate text-sm font-medium">{b.label}</span>
							<Badge variant="secondary" class={cn('shrink-0', scoreBadgeClass(b.bestScore))}>
								{(b.bestScore * 100).toFixed(0)}%
							</Badge>
							<span class="shrink-0 text-[11px] text-muted-foreground tabular-nums">
								{b.count}×
							</span>
						</div>
					</button>

					<!-- Timeline strip -->
					<div class="relative mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
						{#each b.windows as w (w.id)}
							<button
								type="button"
								class={cn(
									'absolute top-0 bottom-0 rounded-sm transition-opacity hover:opacity-90',
									scoreBarClass(w.score)
								)}
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
										class="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] tabular-nums hover:bg-accent"
										onclick={() => onseek?.(w.startSeconds)}
									>
										<AppIcon name={ICONS.play} class="size-2.5" />
										{formatTime(w.startSeconds)}
										<span class="text-muted-foreground"> · {(w.score * 100).toFixed(0)}% </span>
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
