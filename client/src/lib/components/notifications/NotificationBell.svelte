<script lang="ts">
	import { onMount } from 'svelte';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { notifications } from '$lib/state/notifications.svelte';
	import { notificationsSocket } from '$lib/state/notifications-socket.svelte';
	import NotificationDropdown from './NotificationDropdown.svelte';

	/**
	 * Bell button with an unread-count badge, opening the notification dropdown in
	 * a Skeleton Popover. Ported from the Nuxt `NotificationBell.vue`: on mount it
	 * opens the activity WebSocket, wires incoming activity into the global
	 * notifications store, and fetches the initial unread count for the badge.
	 */
	let open = $state(false);

	onMount(() => {
		// Connect WS + wire incoming activity into the global notifications state.
		notificationsSocket.connect();
		notificationsSocket.onActivity((activity) => {
			if (!activity?.id) return;
			notifications.prependLive(activity);
		});
		// Initial unread count for the badge.
		notifications.refreshUnreadCount().catch(() => {});
	});

	const badgeText = $derived.by(() => {
		const n = notifications.unreadCount;
		if (n <= 0) return null;
		return n > 99 ? '99+' : String(n);
	});
</script>

<Popover {open} onOpenChange={(e) => (open = e.open)} positioning={{ placement: 'bottom-end' }}>
	<Popover.Trigger
		class="relative rounded-md p-1 transition-colors hover:preset-tonal"
		aria-label="Notifications"
	>
		<AppIcon name={ICONS.bell} class="size-5" />
		{#if badgeText}
			<span
				class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-center text-[10px] leading-4 font-semibold text-white"
			>
				{badgeText}
			</span>
		{/if}
	</Popover.Trigger>

	<Popover.Positioner class="z-50">
		<Popover.Content
			class="card rounded-lg border border-surface-200-800 preset-filled-surface-100-900 shadow-xl"
		>
			<NotificationDropdown onclose={() => (open = false)} />
		</Popover.Content>
	</Popover.Positioner>
</Popover>
