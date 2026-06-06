<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
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

	// Repopulate the editable fields whenever a (different) moment is loaded —
	// mirrors the Vue `watch(() => props.moment, …, { immediate: true })`. Keyed on
	// `moment?.id` so user edits aren't clobbered on unrelated reactive churn.
	let lastId: string | null = null;
	$effect(() => {
		const m = moment;
		if (!m) return;
		if (m.id === lastId) return;
		lastId = m.id;
		name = m.name;
		description = m.description;
		startSeconds = m.startSeconds;
		endSeconds = m.endSeconds;
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
</script>

{#if moment}
	<div class="flex flex-col card preset-outlined-surface-200-800 bg-surface-50-950">
		<!-- Header -->
		<div class="flex items-center justify-between gap-2 border-b border-surface-200-800 p-3">
			<p class="text-sm font-semibold">Edit moment</p>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="btn preset-tonal-primary btn-sm"
					disabled={reprocessDisabled}
					title="Reprocess"
					onclick={() => onexport?.(moment.id)}
				>
					<AppIcon name={ICONS.reload} class="size-4" />
					Reprocess
				</button>

				<button
					type="button"
					class="btn-icon btn-icon-sm preset-tonal-surface"
					title="Download"
					disabled={downloadPending}
					onclick={() => ondownload?.(moment.id)}
				>
					{#if downloadPending}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.download} class="size-4" />
					{/if}
				</button>

				<button
					type="button"
					class="btn-icon btn-icon-sm preset-tonal-surface"
					title="Share"
					onclick={() => onshare?.(moment.id)}
				>
					<AppIcon name={ICONS.share} class="size-4" />
				</button>

				<button
					type="button"
					class="btn-icon btn-icon-sm preset-tonal-surface"
					aria-label="Close"
					title="Close"
					onclick={() => onclose?.()}
				>
					<AppIcon name={ICONS.close} class="size-4" />
				</button>
			</div>
		</div>

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
					<button
						type="button"
						class="btn-icon btn-icon-sm preset-tonal-primary"
						title="Set to playhead"
						onclick={() => onsetToPlayhead?.('start')}
					>
						<AppIcon name={ICONS.snapToPlayhead} class="size-4" />
					</button>
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
					<button
						type="button"
						class="btn-icon btn-icon-sm preset-tonal-primary"
						title="Set to playhead"
						onclick={() => onsetToPlayhead?.('end')}
					>
						<AppIcon name={ICONS.snapToPlayhead} class="size-4" />
					</button>
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="flex w-full items-center justify-end gap-2 border-t border-surface-200-800 p-3">
			<button type="button" class="btn preset-tonal-error btn-sm" onclick={onDelete}>
				<AppIcon name={ICONS.trash} class="size-4" />
				Delete
			</button>
			<button type="button" class="btn preset-filled-primary-500 btn-sm" onclick={onSave}>
				<AppIcon name={ICONS.save} class="size-4" />
				Save
			</button>
		</div>
	</div>
{/if}
