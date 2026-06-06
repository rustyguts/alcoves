<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { createLibraryFeed } from '$lib/state/library-feed.svelte';
	import { notificationsSocket } from '$lib/state/notifications-socket.svelte';
	import { groupActivities } from '$lib/utils/activity-format';
	import { ICONS } from '$lib/utils/icons';
	import NotificationItem from '$lib/components/notifications/NotificationItem.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	const libraryId = $derived(page.params.id ?? '');

	const feed = createLibraryFeed(() => libraryId);

	let unsubscribe: (() => void) | null = null;
	let room = '';

	onMount(async () => {
		await feed.loadFirst();
		notificationsSocket.connect();
		room = `library:${libraryId}`;
		notificationsSocket.subscribeRoom(room);
		unsubscribe = notificationsSocket.onActivity((activity) => {
			if (activity.libraryId === libraryId) {
				feed.prependLive(activity);
			}
		});
	});

	onDestroy(() => {
		if (room) notificationsSocket.unsubscribeRoom(room);
		if (unsubscribe) unsubscribe();
	});

	const groups = $derived(groupActivities(feed.entries));

	function onNavigate(href: string) {
		goto(href);
	}
</script>

<div class="flex h-full flex-col">
	<div class="border-b border-surface-200-800 px-4 py-3">
		<h2 class="text-base font-semibold">Activity feed</h2>
		<p class="mt-0.5 text-xs text-surface-600-400">Everything that has happened in this library.</p>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if feed.loading && feed.entries.length === 0}
			<div class="px-4 py-8 text-center text-sm text-surface-600-400">
				<AppIcon name={ICONS.loading} class="inline-block size-5 animate-spin" />
				<p class="mt-2">Loading…</p>
			</div>
		{:else if feed.entries.length === 0}
			<div class="px-4 py-12 text-center text-sm text-surface-600-400">No activity yet.</div>
		{:else}
			<div class="divide-y divide-surface-200-800">
				{#each groups as g (g.head.id)}
					<NotificationItem
						group={g}
						showLibraryName={false}
						showDismiss={false}
						onnavigate={onNavigate}
					/>
				{/each}
			</div>
		{/if}
		{#if feed.nextCursor}
			<div class="px-4 py-4 text-center">
				<button
					type="button"
					class="text-sm text-primary-500 hover:underline"
					disabled={feed.loadingMore}
					onclick={() => feed.loadMore()}
				>
					{feed.loadingMore ? 'Loading…' : 'Load older'}
				</button>
			</div>
		{/if}
	</div>
</div>
