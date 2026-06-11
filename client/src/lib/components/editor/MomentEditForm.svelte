<script lang="ts">
	/**
	 * MomentEditForm — edit panel for the selected moment.
	 *
	 * Editable name/description/start/end with set-to-playhead and jump-to
	 * buttons, an export-status row (progress bar + ETA while encoding, and a
	 * staleness chip when the time range changed since the last export), and
	 * the Reprocess / Download / Share / Close / Delete / Save actions.
	 *
	 * Fields repopulate ONLY when a different moment id arrives, so in-progress
	 * edits survive reactive churn like the 2s export poll updating the same
	 * moment (the `lastId` guard).
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatTimecode } from '$lib/utils/timeline-geometry';
	import type { Moment } from '$lib/types/api';

	interface SavePatch {
		name: string;
		description: string;
		startSeconds: number;
		endSeconds: number;
	}

	interface Props {
		moment: Moment | null;
		duration: number;
		downloadPending?: boolean;
		onsave?: (patch: SavePatch) => void;
		onsetToPlayhead?: (field: 'start' | 'end') => void;
		onjumpto?: (seconds: number) => void;
		ondelete?: (momentId: string) => void;
		onclose?: () => void;
		onexport?: (momentId: string) => void;
		ondownload?: (momentId: string) => void;
		onshare?: (momentId: string) => void;
	}

	let {
		moment,
		duration,
		downloadPending = false,
		onsave,
		onsetToPlayhead,
		onjumpto,
		ondelete,
		onclose,
		onexport,
		ondownload,
		onshare
	}: Props = $props();

	let name = $state('');
	let description = $state('');
	let startSeconds = $state<number | string>(0);
	let endSeconds = $state<number | string>(0);

	// Per-field repopulation: a field follows the server value for as long as
	// the user hasn't touched it (local value still equals the last server
	// snapshot), and sticks once they have. A different moment id resets
	// everything. This keeps in-progress edits safe across the 2s export poll
	// while still reflecting external range commits (I/O keys, set-to-playhead,
	// timeline batch saves) — a plain id guard would silently REVERT those on
	// the next Save.
	let lastId: string | null = null;
	let snapshot = { name: '', description: '', startSeconds: 0, endSeconds: 0 };
	$effect(() => {
		const m = moment;
		if (!m) return;
		const newMoment = m.id !== lastId;
		lastId = m.id;
		if (newMoment || name === snapshot.name) name = m.name;
		if (newMoment || description === snapshot.description) description = m.description;
		if (newMoment || Number(startSeconds) === snapshot.startSeconds) startSeconds = m.startSeconds;
		if (newMoment || Number(endSeconds) === snapshot.endSeconds) endSeconds = m.endSeconds;
		snapshot = {
			name: m.name,
			description: m.description,
			startSeconds: m.startSeconds,
			endSeconds: m.endSeconds
		};
	});

	function onSave() {
		if (!moment) return;
		const start = Math.max(0, Number(startSeconds) || 0);
		const end = Math.max(start + 0.001, Number(endSeconds) || 0);
		onsave?.({ name, description, startSeconds: start, endSeconds: end });
	}

	function onDelete() {
		if (!moment) return;
		ondelete?.(moment.id);
	}

	const reprocessDisabled = $derived(
		moment?.exportStatus === 'queued' || moment?.exportStatus === 'processing'
	);

	const exporting = $derived(
		moment?.exportStatus === 'queued' || moment?.exportStatus === 'processing'
	);

	// A range edit makes the backend NULL exportStatus/exportedVersion and bump
	// exportVersion past its starting 1 — that's the only observable "had an
	// export, range changed since" state (exportedVersion never survives the
	// reset, so comparing the two versions would be dead code).
	const exportStale = $derived(
		moment != null && moment.exportStatus === null && moment.exportVersion > 1
	);

	const clipLength = $derived(
		moment ? `${(moment.endSeconds - moment.startSeconds).toFixed(2)}s` : ''
	);
</script>

{#if moment}
	<div
		class="flex flex-col card preset-outlined-surface-200-800 bg-surface-50-950"
		data-testid="moment-edit-form"
	>
		<!-- Header -->
		<div class="flex items-center justify-between gap-2 border-b border-surface-200-800 p-3">
			<div class="flex min-w-0 items-center gap-2">
				<p class="text-sm font-semibold whitespace-nowrap">Edit moment</p>
				<span class="badge preset-tonal-surface text-xs tabular-nums">{clipLength}</span>
				{#if exportStale}
					<span
						class="badge preset-tonal-warning text-xs"
						title="The time range changed — reprocess to refresh the export"
					>
						Edited since export
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-1">
				<Button
					variant="tonal"
					color="primary"
					size="sm"
					disabled={reprocessDisabled}
					title="Reprocess"
					onclick={() => onexport?.(moment.id)}
				>
					{#snippet icon()}
						<AppIcon name={ICONS.reload} class="size-4" />
					{/snippet}
					Reprocess
				</Button>

				<Button
					iconOnly
					size="sm"
					variant="tonal"
					color="surface"
					title="Download"
					loading={downloadPending}
					onclick={() => ondownload?.(moment.id)}
				>
					{#snippet icon()}
						<AppIcon name={ICONS.download} class="size-4" />
					{/snippet}
				</Button>

				<Button
					iconOnly
					size="sm"
					variant="tonal"
					color="surface"
					title="Share"
					onclick={() => onshare?.(moment.id)}
				>
					{#snippet icon()}
						<AppIcon name={ICONS.share} class="size-4" />
					{/snippet}
				</Button>

				<Button
					iconOnly
					size="sm"
					variant="tonal"
					color="surface"
					aria-label="Close"
					title="Close"
					onclick={() => onclose?.()}
				>
					{#snippet icon()}
						<AppIcon name={ICONS.close} class="size-4" />
					{/snippet}
				</Button>
			</div>
		</div>

		<!-- Export progress -->
		{#if exporting}
			<div class="flex items-center gap-2 border-b border-surface-200-800 px-3 py-2">
				<AppIcon name={ICONS.loading} class="size-3.5 animate-spin text-warning-500" />
				<div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-200-800/70">
					<div
						class="absolute inset-y-0 left-0 rounded-full bg-warning-500 transition-[width]"
						style="width: {Math.max(0, Math.min(100, moment.exportProgress ?? 0))}%;"
					></div>
				</div>
				<span class="shrink-0 text-[11px] text-surface-600-400 tabular-nums">
					{moment.exportProgress != null ? `${Math.round(moment.exportProgress)}%` : 'Queued'}
					{#if moment.exportEtaSeconds != null}
						· ≈ {Math.max(1, Math.round(moment.exportEtaSeconds))}s left
					{/if}
				</span>
			</div>
		{/if}

		<!-- Body -->
		<div class="flex flex-col gap-2 p-3">
			<div class="flex items-center gap-2">
				<label class="w-24 shrink-0 text-xs font-medium text-surface-600-400" for="moment-name">
					Name
				</label>
				<input
					id="moment-name"
					class="input min-w-0 flex-1"
					placeholder="Untitled"
					bind:value={name}
				/>
			</div>

			<div class="flex gap-2">
				<label
					class="w-24 shrink-0 self-start pt-1.5 text-xs font-medium text-surface-600-400"
					for="moment-description"
				>
					Description
				</label>
				<textarea
					id="moment-description"
					class="textarea min-w-0 flex-1"
					placeholder="Notes"
					rows="2"
					bind:value={description}
				></textarea>
			</div>

			<div class="flex flex-wrap gap-2">
				<div class="flex min-w-[220px] flex-1 items-center gap-2">
					<label class="w-24 shrink-0 text-xs font-medium text-surface-600-400" for="moment-start">
						Start
					</label>
					<input
						id="moment-start"
						class="input min-w-0 flex-1"
						type="number"
						step="0.01"
						min="0"
						max={duration}
						bind:value={startSeconds}
					/>
					<Button
						iconOnly
						size="sm"
						variant="tonal"
						color="primary"
						title="Set to playhead"
						aria-label="Set start to playhead"
						onclick={() => onsetToPlayhead?.('start')}
					>
						{#snippet icon()}
							<AppIcon name={ICONS.snapToPlayhead} class="size-4" />
						{/snippet}
					</Button>
					<Button
						iconOnly
						size="sm"
						variant="tonal"
						color="surface"
						title="Jump to start ({formatTimecode(moment.startSeconds, { fractionDigits: 1 })})"
						aria-label="Jump to start"
						onclick={() => onjumpto?.(moment.startSeconds)}
					>
						{#snippet icon()}
							<AppIcon name={ICONS.play} class="size-4" />
						{/snippet}
					</Button>
				</div>

				<div class="flex min-w-[220px] flex-1 items-center gap-2">
					<label class="w-24 shrink-0 text-xs font-medium text-surface-600-400" for="moment-end">
						End
					</label>
					<input
						id="moment-end"
						class="input min-w-0 flex-1"
						type="number"
						step="0.01"
						min="0"
						max={duration}
						bind:value={endSeconds}
					/>
					<Button
						iconOnly
						size="sm"
						variant="tonal"
						color="primary"
						title="Set to playhead"
						aria-label="Set end to playhead"
						onclick={() => onsetToPlayhead?.('end')}
					>
						{#snippet icon()}
							<AppIcon name={ICONS.snapToPlayhead} class="size-4" />
						{/snippet}
					</Button>
					<Button
						iconOnly
						size="sm"
						variant="tonal"
						color="surface"
						title="Jump to end ({formatTimecode(moment.endSeconds, { fractionDigits: 1 })})"
						aria-label="Jump to end"
						onclick={() => onjumpto?.(moment.endSeconds)}
					>
						{#snippet icon()}
							<AppIcon name={ICONS.play} class="size-4" />
						{/snippet}
					</Button>
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="flex w-full items-center justify-end gap-2 border-t border-surface-200-800 p-3">
			<Button variant="tonal" color="error" size="sm" onclick={onDelete}>
				{#snippet icon()}
					<AppIcon name={ICONS.trash} class="size-4" />
				{/snippet}
				Delete
			</Button>
			<Button size="sm" onclick={onSave}>
				{#snippet icon()}
					<AppIcon name={ICONS.save} class="size-4" />
				{/snippet}
				Save
			</Button>
		</div>
	</div>
{/if}
