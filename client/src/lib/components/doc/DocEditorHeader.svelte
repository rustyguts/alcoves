<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
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

	function handleModeChange(value: string) {
		// bits-ui Tabs never deselects (a click on the already-active tab is a
		// no-op internally), so `value` is always one of `modes` here.
		onmode?.(value as DocViewMode);
	}
</script>

<div class="flex w-full flex-wrap items-center gap-3">
	<Button variant="ghost" size="sm" onclick={() => onback?.()} class="gap-1.5">
		<AppIcon name={ICONS.back} class="size-4" />
		Back
	</Button>

	<div class="flex min-w-0 flex-1 items-center gap-2">
		<AppIcon name={ICONS.file} class="size-5 shrink-0 text-muted-foreground" />
		<p class="truncate text-lg font-semibold">{file?.name ?? 'Loading…'}</p>
	</div>

	<span class="text-xs text-muted-foreground" data-testid="doc-status">{statusLabel}</span>

	{#if shownPeers.length > 0}
		<Avatar.Group data-testid="doc-peers">
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
				<Avatar.GroupCount class="size-7 text-[0.6rem] font-semibold">
					+{overflow}
				</Avatar.GroupCount>
			{/if}
		</Avatar.Group>
	{/if}

	<Tabs.Root value={mode} onValueChange={handleModeChange}>
		<Tabs.List aria-label="View mode">
			{#each modes as m (m.value)}
				<Tabs.Trigger value={m.value}>{m.label}</Tabs.Trigger>
			{/each}
		</Tabs.List>
	</Tabs.Root>
</div>
