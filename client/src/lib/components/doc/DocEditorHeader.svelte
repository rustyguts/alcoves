<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { DocPeer } from '$lib/collab/doc-provider.svelte';
	import type { LibraryFile } from '$lib/types/api';

	export type DocViewMode = 'edit' | 'split' | 'preview';

	interface Props {
		file: LibraryFile | null | undefined;
		peers: DocPeer[];
		statusLabel: string;
		canEdit: boolean;
		mode: DocViewMode;
		onback?: () => void;
		onmode?: (mode: DocViewMode) => void;
	}

	let { file, peers, statusLabel, canEdit, mode, onback, onmode }: Props = $props();

	const MAX_AVATARS = 4;
	const shownPeers = $derived(peers.slice(0, MAX_AVATARS));
	const overflow = $derived(Math.max(0, peers.length - MAX_AVATARS));

	// Viewers still get the source pane (read-only, with live cursors) but the
	// label says what it is.
	const modes = $derived<Array<{ value: DocViewMode; label: string }>>(
		canEdit
			? [
					{ value: 'edit', label: 'Edit' },
					{ value: 'split', label: 'Split' },
					{ value: 'preview', label: 'Preview' }
				]
			: [
					{ value: 'preview', label: 'Preview' },
					{ value: 'edit', label: 'Source' }
				]
	);

	const statusClass = $derived.by(() => {
		if (statusLabel.startsWith('Offline')) return 'preset-tonal-warning';
		if (statusLabel === 'Saving…') return 'preset-tonal-primary';
		if (statusLabel === 'Read-only') return 'preset-tonal-surface';
		return 'preset-tonal-success';
	});
</script>

<div class="flex w-full flex-wrap items-center gap-3">
	<Button variant="tonal" color="surface" size="sm" onclick={() => onback?.()}>
		{#snippet icon()}
			<AppIcon name={ICONS.back} class="size-4" />
		{/snippet}
		Back
	</Button>

	<div class="flex min-w-0 flex-1 items-center gap-2">
		<AppIcon name={ICONS.file} class="size-5 shrink-0 opacity-70" />
		<p class="truncate text-lg font-semibold">{file?.name ?? 'Loading…'}</p>
	</div>

	<span class="badge text-xs {statusClass}" data-testid="doc-status">{statusLabel}</span>

	{#if shownPeers.length > 0}
		<div class="flex items-center -space-x-2" data-testid="doc-peers">
			{#each shownPeers as peer (peer.clientId)}
				<div
					class="rounded-full"
					style="box-shadow: 0 0 0 2px {peer.color}"
					title={peer.name}
					data-testid="doc-peer"
				>
					<UserAvatar displayName={peer.name} sizeClass="size-7" textSizeClass="text-[0.6rem]" />
				</div>
			{/each}
			{#if overflow > 0}
				<span
					class="z-10 grid size-7 place-items-center rounded-full preset-tonal-surface text-[0.6rem] font-semibold"
				>
					+{overflow}
				</span>
			{/if}
		</div>
	{/if}

	<div
		class="flex overflow-hidden rounded-lg border border-surface-300-700"
		role="group"
		aria-label="View mode"
	>
		{#each modes as m (m.value)}
			<button
				type="button"
				class="px-3 py-1.5 text-sm transition-colors {mode === m.value
					? 'preset-filled-primary-500'
					: 'hover:preset-tonal'}"
				aria-pressed={mode === m.value}
				onclick={() => onmode?.(m.value)}
			>
				{m.label}
			</button>
		{/each}
	</div>
</div>
