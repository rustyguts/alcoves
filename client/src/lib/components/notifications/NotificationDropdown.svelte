<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { notifications } from '$lib/state/notifications.svelte';
	import { groupActivities } from '$lib/utils/activity-format';
	import NotificationItem from './NotificationItem.svelte';

	interface Props {
		onclose?: () => void;
	}

	let { onclose }: Props = $props();

	onMount(() => {
		if (notifications.entries.length === 0) {
			notifications.loadFirst();
		}
	});

	const groups = $derived(groupActivities(notifications.entries).slice(0, 20));
	const hasMore = $derived(notifications.entries.length > 20 || notifications.nextCursor !== null);

	function onDismiss(ids: string[]) {
		for (const id of ids) notifications.dismiss(id);
	}

	async function onDismissAll() {
		await notifications.dismissAll();
	}

	function onNavigate(href: string) {
		goto(href);
		onclose?.();
	}

	function viewAll() {
		goto('/notifications');
		onclose?.();
	}
</script>

<div class="flex w-96 max-w-[90vw] flex-col overflow-hidden rounded-md">
	<div class="flex items-center justify-between px-4 py-2.5">
		<h3 class="text-sm font-semibold">Notifications</h3>
		{#if notifications.entries.length > 0}
			<button
				type="button"
				class="text-xs text-muted-foreground underline hover:text-foreground"
				onclick={onDismissAll}
			>
				Dismiss all
			</button>
		{/if}
	</div>
	<div class="max-h-96 overflow-y-auto">
		{#if notifications.loading && notifications.entries.length === 0}
			<div class="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</div>
		{:else if notifications.entries.length === 0}
			<div class="px-4 py-6 text-center text-sm text-muted-foreground">You're all caught up.</div>
		{:else}
			{#each groups as g (g.head.id)}
				<NotificationItem
					group={g}
					showLibraryName={true}
					showDismiss={true}
					ondismiss={onDismiss}
					onnavigate={onNavigate}
				/>
			{/each}
		{/if}
	</div>
	{#if hasMore}
		<button
			type="button"
			class="px-4 py-2.5 text-center text-sm text-primary hover:bg-muted"
			onclick={viewAll}
		>
			See all notifications
		</button>
	{/if}
</div>
