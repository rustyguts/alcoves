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
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatTimecode } from '$lib/utils/timeline-geometry';
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

	// Skeleton badge preset per export status. `neutral`/idle uses the surface
	// palette since there is no dedicated neutral preset.
	function statusBadge(m: Moment): { preset: string; label: string } {
		const status: MomentExportStatus = m.exportStatus;
		switch (status) {
			case 'queued':
				return { preset: 'preset-tonal-warning', label: 'queued' };
			case 'processing':
				return {
					preset: 'preset-tonal-warning',
					label: m.exportProgress != null ? `${m.exportProgress}%` : 'processing'
				};
			case 'ready':
				return { preset: 'preset-tonal-success', label: 'ready' };
			case 'failed':
				return { preset: 'preset-tonal-error', label: 'failed' };
			default:
				return { preset: 'preset-tonal-surface', label: '—' };
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
				{#snippet icon()}
					<AppIcon name={ICONS.plus} class="size-4" />
				{/snippet}
				New moment
				<kbd class="ml-1 rounded bg-surface-200-800/60 px-1 text-[10px]">M</kbd>
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
					class="cursor-pointer card p-2 transition-colors outline-none {m.id === selectedId
						? 'preset-tonal-primary ring-2 ring-primary-500'
						: 'preset-tonal-surface hover:bg-surface-200-800 focus-visible:ring-2 focus-visible:ring-primary-500'}"
					onclick={() => select(m.id)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							e.stopPropagation();
							select(m.id);
						}
					}}
				>
					<div class="flex flex-col gap-0.5">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate text-xs font-medium">{m.name || 'Untitled'}</span>
							<span class="badge shrink-0 text-xs {badge.preset}">{badge.label}</span>
						</div>
						<div class="flex items-center gap-2 text-[10px] text-surface-600-400 tabular-nums">
							<span>{formatRange(m)}</span>
							<span>·</span>
							<span>{formatLength(m)}</span>
							<span class="flex-1"></span>
							<button
								type="button"
								class="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-surface-600-400 hover:preset-tonal hover:text-surface-950-50"
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
				</div>
			</li>
		{/each}
	</ul>
{/if}
