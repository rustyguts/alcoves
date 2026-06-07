<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatActivity, relativeTime, type ActivityGroup } from '$lib/utils/activity-format';

	interface Props {
		group: ActivityGroup;
		showLibraryName?: boolean;
		showDismiss?: boolean;
		ondismiss?: (ids: string[]) => void;
		onnavigate?: (href: string) => void;
	}

	let {
		group,
		showLibraryName = false,
		showDismiss = false,
		ondismiss,
		onnavigate
	}: Props = $props();

	const formatted = $derived(formatActivity(group));
	const time = $derived(relativeTime(group.head.createdAt));
	const idsInGroup = $derived(group.items.map((i) => i.id));

	function onClick(event: MouseEvent) {
		if (formatted.href) {
			if (event.metaKey || event.ctrlKey || event.shiftKey) return; // let browser handle
			event.preventDefault();
			onnavigate?.(formatted.href);
		}
	}

	function onDismiss(event: MouseEvent) {
		event.stopPropagation();
		event.preventDefault();
		ondismiss?.(idsInGroup);
	}
</script>

<svelte:element
	this={formatted.href ? 'a' : 'div'}
	href={formatted.href ?? undefined}
	class="group flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-100-900 focus-visible:bg-surface-100-900 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none focus-visible:ring-inset"
	onclick={onClick}
	role={formatted.href ? undefined : 'button'}
	tabindex={formatted.href ? undefined : 0}
>
	<div class="mt-0.5 shrink-0">
		{#if group.head.actor}
			<UserAvatar
				displayName={group.head.actor.displayName}
				avatarUrl={group.head.actor.avatarUrl}
				sizeClass="w-7"
			/>
		{:else}
			<div
				class="flex size-7 items-center justify-center rounded-full bg-surface-200-800 text-surface-600-400"
			>
				<AppIcon name={formatted.icon} class="size-4" />
			</div>
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex items-baseline gap-1.5">
			<AppIcon name={formatted.icon} class="size-3.5 shrink-0 text-surface-600-400" />
			<p class="truncate text-sm">{formatted.text}</p>
		</div>
		<p class="mt-0.5 text-xs text-surface-600-400">
			{#if showLibraryName && group.head.libraryName}<span
					>{group.head.libraryName} ·
				</span>{/if}<span data-screenshot-mask>{time}</span>
		</p>
	</div>
	{#if showDismiss}
		<button
			type="button"
			class="-m-1 p-1 text-surface-600-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-surface-950-50"
			aria-label="Dismiss notification"
			onclick={onDismiss}
		>
			<AppIcon name={ICONS.close} class="size-4" />
		</button>
	{/if}
</svelte:element>
