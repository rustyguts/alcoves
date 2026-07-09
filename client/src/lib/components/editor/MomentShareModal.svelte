<script lang="ts">
	import AppModal from '$lib/components/ui/AppModal.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import { ICONS } from '$lib/utils/icons';
	import { api } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import type { MomentShare } from '$lib/types/api';

	/**
	 * Create / list / revoke public share links for a moment. Two-way bindable
	 * `open`; refreshes the list whenever it opens (or the moment changes).
	 */

	interface Props {
		/** Controlled visibility (two-way bindable). */
		open?: boolean;
		libraryId: string;
		fileId: string;
		momentId: string | null;
		sharingEnabled: boolean;
	}

	let { open = $bindable(false), libraryId, fileId, momentId, sharingEnabled }: Props = $props();

	let shares = $state<MomentShare[]>([]);
	let loading = $state(false);
	let creating = $state(false);

	async function refresh() {
		if (!momentId) return;
		loading = true;
		try {
			shares = await api.moments.listShares(libraryId, fileId, momentId);
		} catch {
			shares = [];
		} finally {
			loading = false;
		}
	}

	async function onCreate() {
		if (!momentId || !sharingEnabled) return;
		creating = true;
		try {
			const created = await api.moments.createShare(libraryId, fileId, momentId);
			shares = [created, ...shares];
			toast.add({ title: 'Share link created', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to create share link', color: 'error' });
		} finally {
			creating = false;
		}
	}

	async function onRevoke(token: string) {
		if (!momentId) return;
		try {
			await api.moments.revokeShare(libraryId, fileId, momentId, token);
			shares = shares.filter((s) => s.token !== token);
			toast.add({ title: 'Share link revoked', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to revoke', color: 'error' });
		}
	}

	async function copy(url: string) {
		try {
			await navigator.clipboard?.writeText(url);
			toast.add({ title: 'Link copied', color: 'success' });
		} catch {
			toast.add({ title: 'Copy failed', color: 'error' });
		}
	}

	// Mirror the Vue `watch([open, momentId])`: refresh whenever it opens.
	$effect(() => {
		// Track both so a moment swap while open re-fetches too.
		void momentId;
		if (open) refresh();
	});

	const description = $derived(
		sharingEnabled
			? 'Anyone with the link can watch this moment. Revoke to kill access.'
			: 'Sharing is disabled for this library. Turn it on in library settings to create share links.'
	);
</script>

<AppModal bind:open title="Share moment" {description}>
	<div class="flex flex-col gap-3">
		<Button class="self-start" disabled={!sharingEnabled || creating} onclick={onCreate}>
			{#if creating}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{:else}
				<AppIcon name={ICONS.link} class="size-4" />
			{/if}
			<span>Create share link</span>
		</Button>

		{#if loading}
			<div class="text-sm text-muted-foreground">Loading…</div>
		{/if}

		{#if shares.length}
			<div class="flex flex-col gap-2">
				{#each shares as s (s.id)}
					<div class="flex items-center gap-2">
						<InputGroup.Root class="flex-1">
							<InputGroup.Text class="min-w-0 flex-1 truncate font-mono text-xs">
								{s.url}
							</InputGroup.Text>
							<InputGroup.Addon align="inline-end">
								<InputGroup.Button
									size="icon-xs"
									aria-label="Copy link"
									onclick={() => copy(s.url)}
								>
									<AppIcon name={ICONS.copy} class="size-4" />
								</InputGroup.Button>
							</InputGroup.Addon>
						</InputGroup.Root>
						<Button variant="destructive" size="sm" onclick={() => onRevoke(s.token)}>
							<AppIcon name={ICONS.close} class="size-4" />
							<span>Revoke</span>
						</Button>
					</div>
				{/each}
			</div>
		{:else if !loading}
			<div class="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
				No active share links.
			</div>
		{/if}
	</div>
</AppModal>
