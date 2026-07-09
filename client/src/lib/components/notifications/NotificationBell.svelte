<script lang="ts">
	import { onMount } from 'svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { notifications } from '$lib/state/notifications.svelte';
	import { notificationsSocket } from '$lib/state/notifications-socket.svelte';
	import NotificationDropdown from './NotificationDropdown.svelte';

	/**
	 * Bell button with an unread-count badge, opening the notification dropdown in
	 * a Popover (a free-form panel, not a menu — rows carry their own links and
	 * nested dismiss buttons). Ported from the Nuxt `NotificationBell.vue`: on
	 * mount it opens the activity WebSocket, wires incoming activity into the
	 * global notifications store, and fetches the initial unread count for the
	 * badge.
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

<Popover.Root bind:open>
	<Popover.Trigger
		class="relative inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
		aria-label="Notifications"
	>
		<AppIcon name={ICONS.bell} class="size-5" />
		{#if badgeText}
			<Badge
				class="absolute top-1 right-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
			>
				{badgeText}
			</Badge>
		{/if}
	</Popover.Trigger>

	<Popover.Content class="w-96 max-w-[90vw] p-0" align="end">
		<NotificationDropdown onclose={() => (open = false)} />
	</Popover.Content>
</Popover.Root>
