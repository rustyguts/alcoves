<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { notifications } from '$lib/state/notifications.svelte';
	import { notificationsSocket } from '$lib/state/notifications-socket.svelte';
	import { groupActivities, type ActivityGroup } from '$lib/utils/activity-format';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import NotificationItem from '$lib/components/notifications/NotificationItem.svelte';

	let unsubscribe: (() => void) | null = null;

	onMount(() => {
		void notifications.loadFirst();
		notificationsSocket.connect();
		unsubscribe = notificationsSocket.onActivity((activity) => {
			notifications.prependLive(activity);
		});
	});

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
	});

	// Group by library, then by time-bucket inside each library.
	const groupedByLibrary = $derived.by(() => {
		const byLib = new Map<string, typeof notifications.entries>();
		for (const e of notifications.entries) {
			const arr = byLib.get(e.libraryId) ?? [];
			arr.push(e);
			byLib.set(e.libraryId, arr);
		}
		const out: { libraryId: string; libraryName: string; groups: ActivityGroup[] }[] = [];
		for (const [libId, rows] of byLib) {
			out.push({
				libraryId: libId,
				libraryName: rows[0]?.libraryName ?? '',
				groups: groupActivities(rows)
			});
		}
		return out;
	});

	function onNavigate(href: string) {
		goto(href);
	}

	function onDismiss(ids: string[]) {
		for (const id of ids) notifications.dismiss(id);
	}
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center justify-between border-b border-surface-200-800 px-4 py-3">
		<div>
			<h1 class="text-lg font-semibold">Notifications</h1>
			<p class="mt-0.5 text-xs text-surface-600-400">Activity across all your libraries.</p>
		</div>
		{#if notifications.entries.length > 0}
			<button
				type="button"
				class="text-sm text-surface-600-400 underline hover:text-surface-950-50"
				onclick={() => notifications.dismissAll()}
			>
				Dismiss all
			</button>
		{/if}
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if notifications.loading && notifications.entries.length === 0}
			<div class="px-4 py-8 text-center text-sm text-surface-600-400">
				<AppIcon name={ICONS.loading} class="inline-block size-5 animate-spin" />
				<p class="mt-2">Loading…</p>
			</div>
		{:else if notifications.entries.length === 0}
			<div class="px-4 py-12 text-center text-sm text-surface-600-400">You're all caught up.</div>
		{:else}
			{#each groupedByLibrary as lib (lib.libraryId)}
				<section class="border-b border-surface-200-800">
					<header
						class="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-surface-600-400 uppercase"
					>
						{lib.libraryName}
					</header>
					<div class="divide-y divide-surface-200-800">
						{#each lib.groups as g (g.head.id)}
							<NotificationItem
								group={g}
								showLibraryName={false}
								showDismiss={true}
								ondismiss={onDismiss}
								onnavigate={onNavigate}
							/>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
		{#if notifications.nextCursor}
			<div class="px-4 py-4 text-center">
				<button
					type="button"
					class="text-sm text-primary-500 hover:underline"
					disabled={notifications.loadingMore}
					onclick={() => notifications.loadMore()}
				>
					{notifications.loadingMore ? 'Loading…' : 'Load older'}
				</button>
			</div>
		{/if}
	</div>
</div>
