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
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
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

{#snippet iconButton(opts: {
	label: string;
	title?: string;
	icon: string;
	onclick: () => void;
	disabled?: boolean;
	loading?: boolean;
})}
	<Button
		variant="ghost"
		size="icon-sm"
		aria-label={opts.label}
		title={opts.title ?? opts.label}
		disabled={opts.disabled || opts.loading}
		aria-busy={opts.loading || undefined}
		onclick={opts.onclick}
	>
		{#if opts.loading}
			<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
		{:else}
			<AppIcon name={opts.icon} class="size-4" />
		{/if}
	</Button>
{/snippet}

{#if moment}
	<Card.Root size="sm" data-testid="moment-edit-form">
		<!-- Header -->
		<Card.Header class="flex-row items-center justify-between gap-2">
			<div class="flex min-w-0 items-center gap-2">
				<p class="text-sm font-semibold whitespace-nowrap">Edit moment</p>
				<Badge variant="secondary" class="tabular-nums">{clipLength}</Badge>
				{#if exportStale}
					<Badge
						variant="secondary"
						class="bg-warning/10 text-warning"
						title="The time range changed — reprocess to refresh the export"
					>
						Edited since export
					</Badge>
				{/if}
			</div>
			<div class="flex items-center gap-1">
				<Button
					variant="secondary"
					size="sm"
					disabled={reprocessDisabled}
					title="Reprocess"
					onclick={() => onexport?.(moment.id)}
				>
					<AppIcon name={ICONS.reload} class="size-4" />
					Reprocess
				</Button>

				{@render iconButton({
					label: 'Download',
					icon: ICONS.download,
					loading: downloadPending,
					onclick: () => ondownload?.(moment.id)
				})}
				{@render iconButton({
					label: 'Share',
					icon: ICONS.share,
					onclick: () => onshare?.(moment.id)
				})}
				{@render iconButton({
					label: 'Close',
					icon: ICONS.close,
					onclick: () => onclose?.()
				})}
			</div>
		</Card.Header>

		<!-- Export progress -->
		{#if exporting}
			<div class="flex items-center gap-2 px-4 py-2">
				<AppIcon name={ICONS.loading} class="size-3.5 animate-spin text-warning" />
				<Progress
					value={Math.max(0, Math.min(100, moment.exportProgress ?? 0))}
					class="h-1.5 flex-1"
				/>
				<span class="shrink-0 text-[11px] text-muted-foreground tabular-nums">
					{moment.exportProgress != null ? `${Math.round(moment.exportProgress)}%` : 'Queued'}
					{#if moment.exportEtaSeconds != null}
						· ≈ {Math.max(1, Math.round(moment.exportEtaSeconds))}s left
					{/if}
				</span>
			</div>
		{/if}

		<!-- Body -->
		<Card.Content class="flex flex-col gap-2 py-3">
			<div class="flex items-center gap-2">
				<Label class="w-24 shrink-0 text-xs text-muted-foreground" for="moment-name">Name</Label>
				<Input id="moment-name" class="min-w-0 flex-1" placeholder="Untitled" bind:value={name} />
			</div>

			<div class="flex gap-2">
				<Label
					class="w-24 shrink-0 self-start pt-1.5 text-xs text-muted-foreground"
					for="moment-description"
				>
					Description
				</Label>
				<Textarea
					id="moment-description"
					class="min-w-0 flex-1"
					placeholder="Notes"
					rows={2}
					bind:value={description}
				/>
			</div>

			<div class="flex flex-wrap gap-2">
				<div class="flex min-w-[220px] flex-1 items-center gap-2">
					<Label class="w-24 shrink-0 text-xs text-muted-foreground" for="moment-start">
						Start
					</Label>
					<Input
						id="moment-start"
						class="min-w-0 flex-1"
						type="number"
						step="0.01"
						min="0"
						max={duration}
						bind:value={startSeconds}
					/>
					{@render iconButton({
						label: 'Set start to playhead',
						icon: ICONS.snapToPlayhead,
						onclick: () => onsetToPlayhead?.('start')
					})}
					{@render iconButton({
						label: 'Jump to start',
						title: `Jump to start (${formatTimecode(moment.startSeconds, { fractionDigits: 1 })})`,
						icon: ICONS.play,
						onclick: () => onjumpto?.(moment.startSeconds)
					})}
				</div>

				<div class="flex min-w-[220px] flex-1 items-center gap-2">
					<Label class="w-24 shrink-0 text-xs text-muted-foreground" for="moment-end">End</Label>
					<Input
						id="moment-end"
						class="min-w-0 flex-1"
						type="number"
						step="0.01"
						min="0"
						max={duration}
						bind:value={endSeconds}
					/>
					{@render iconButton({
						label: 'Set end to playhead',
						icon: ICONS.snapToPlayhead,
						onclick: () => onsetToPlayhead?.('end')
					})}
					{@render iconButton({
						label: 'Jump to end',
						title: `Jump to end (${formatTimecode(moment.endSeconds, { fractionDigits: 1 })})`,
						icon: ICONS.play,
						onclick: () => onjumpto?.(moment.endSeconds)
					})}
				</div>
			</div>
		</Card.Content>

		<!-- Footer -->
		<Card.Footer class="justify-end gap-2">
			<Button variant="destructive" size="sm" onclick={onDelete}>
				<AppIcon name={ICONS.trash} class="size-4" />
				Delete
			</Button>
			<Button size="sm" onclick={onSave}>
				<AppIcon name={ICONS.save} class="size-4" />
				Save
			</Button>
		</Card.Footer>
	</Card.Root>
{/if}
