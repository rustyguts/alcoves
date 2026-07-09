<script lang="ts">
	/**
	 * MomentsList — the Moments inspector tab's list.
	 *
	 * Moments sorted by start time as selectable cards: name, export-status
	 * badge, time range + clip length, and a jump-to-start button. Click (or
	 * Enter/Space) selects; the jump button seeks without changing selection
	 * focus semantics. Empty state offers the create CTA.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatTimecode } from '$lib/utils/timeline-geometry';
	import { cn } from '$lib/utils';
	import type { Moment, MomentExportStatus } from '$lib/types/api';

	interface Props {
		moments: Moment[];
		selectedId: string | null;
		onselect?: (momentId: string) => void;
		onjumpto?: (momentId: string) => void;
		oncreate?: () => void;
	}

	let { moments, selectedId, onselect, onjumpto, oncreate }: Props = $props();

	const sortedMoments = $derived([...moments].sort((a, b) => a.startSeconds - b.startSeconds));

	function formatLength(m: Moment): string {
		return `${(m.endSeconds - m.startSeconds).toFixed(2)}s`;
	}

	function formatRange(m: Moment): string {
		return `${formatTimecode(m.startSeconds, { fractionDigits: 1 })} – ${formatTimecode(
			m.endSeconds,
			{ fractionDigits: 1 }
		)}`;
	}

	function statusBadge(m: Moment): { class: string; label: string } {
		const status: MomentExportStatus = m.exportStatus;
		switch (status) {
			case 'queued':
				return { class: 'bg-warning/10 text-warning', label: 'queued' };
			case 'processing':
				return {
					class: 'bg-warning/10 text-warning',
					label: m.exportProgress != null ? `${m.exportProgress}%` : 'processing'
				};
			case 'ready':
				return { class: 'bg-success/10 text-success', label: 'ready' };
			case 'failed':
				return { class: '', label: 'failed' };
			default:
				return { class: '', label: '—' };
		}
	}

	function select(id: string) {
		onselect?.(id);
	}
</script>

{#if moments.length === 0}
	<EmptyState
		icon={ICONS.movie}
		title="No moments yet"
		description="Mark a time range to clip, export and share it."
	>
		{#snippet actions()}
			<Button size="sm" onclick={() => oncreate?.()}>
				<AppIcon name={ICONS.plus} class="size-4" />
				New moment
				<Kbd class="ml-1">M</Kbd>
			</Button>
		{/snippet}
	</EmptyState>
{:else}
	<ul class="flex flex-col gap-1" data-testid="moments-list">
		{#each sortedMoments as m (m.id)}
			{@const badge = statusBadge(m)}
			<li>
				<div
					role="button"
					tabindex="0"
					class={cn(
						'flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2 transition-colors outline-none',
						m.id === selectedId
							? 'border-primary bg-primary/10 ring-2 ring-primary'
							: 'border-transparent bg-muted hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring'
					)}
					onclick={() => select(m.id)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							e.stopPropagation();
							select(m.id);
						}
					}}
				>
					<div class="flex items-center justify-between gap-2">
						<span class="truncate text-xs font-medium">{m.name || 'Untitled'}</span>
						{#if badge.label === 'failed'}
							<Badge variant="destructive" class="shrink-0">{badge.label}</Badge>
						{:else}
							<Badge variant="secondary" class={cn('shrink-0', badge.class)}>{badge.label}</Badge>
						{/if}
					</div>
					<div class="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
						<span>{formatRange(m)}</span>
						<span>·</span>
						<span>{formatLength(m)}</span>
						<span class="flex-1"></span>
						<button
							type="button"
							class="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							title="Jump to start"
							aria-label="Jump to start of {m.name || 'Untitled'}"
							onclick={(e) => {
								e.stopPropagation();
								onjumpto?.(m.id);
							}}
						>
							<AppIcon name={ICONS.play} class="size-2.5" />
							Jump
						</button>
					</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}
