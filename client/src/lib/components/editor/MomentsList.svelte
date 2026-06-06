<script lang="ts">
	/**
	 * MomentsList — the editor's list of moments for a file.
	 *
	 * Moments are sorted by their start time and rendered as selectable cards. Each
	 * card shows its name, the time range, the clip duration and an export-status
	 * badge. Clicking (or pressing Enter/Space on) a card fires `onselect` with the
	 * moment id.
	 */
	import type { Moment, MomentExportStatus } from '$lib/types/api';

	interface Props {
		moments: Moment[];
		selectedId: string | null;
		onselect?: (momentId: string) => void;
	}

	let { moments, selectedId, onselect }: Props = $props();

	const sortedMoments = $derived([...moments].sort((a, b) => a.startSeconds - b.startSeconds));

	function formatDuration(m: Moment): string {
		return `${(m.endSeconds - m.startSeconds).toFixed(2)}s`;
	}

	function formatRange(m: Moment): string {
		return `${m.startSeconds.toFixed(1)}s – ${m.endSeconds.toFixed(1)}s`;
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

<div class="card border border-surface-200-800 bg-surface-50-950">
	<header class="flex items-center justify-between gap-2 border-b border-surface-200-800 px-3 py-2">
		<p class="text-sm font-semibold">Moments</p>
		<span class="text-[11px] text-surface-600-400 tabular-nums">{moments.length}</span>
	</header>

	<div class="max-h-[60vh] overflow-y-auto p-3 lg:max-h-[400px]">
		{#if moments.length === 0}
			<div
				class="rounded-lg border border-dashed border-surface-300-700 p-4 text-center text-xs text-surface-600-400"
			>
				No moments yet. Press
				<kbd class="rounded bg-surface-200-800 px-1">M</kbd>
				to create one.
			</div>
		{:else}
			<ul class="flex flex-col gap-1">
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
									<span>{formatDuration(m)}</span>
								</div>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
