<script lang="ts">
	/**
	 * SettingsSection — the flat, card-free section used on the library settings
	 * page.
	 *
	 * Where AppPanel wraps a card (a filled tonal block that still reads as a
	 * card), a SettingsSection lays its content directly on the page background.
	 * Stack a column of these inside a `divide-y` wrapper and the page becomes a
	 * clean flat list: each group is just an icon + title + description header with
	 * its controls below, separated from its neighbours by a single hairline rule.
	 * Mirrors AppPanel's API (title / description / icon + `title` and `actions`
	 * snippets) so swapping is mechanical.
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		title?: string;
		description?: string;
		/** An ICONS registry value, e.g. `lineicons:cog`. */
		icon?: string;
		/** Replaces the default icon + title row. */
		title_?: Snippet;
		/** Right-pinned header actions. */
		actions?: Snippet;
		/** Section body. */
		children?: Snippet;
	}

	let { title, description, icon, title_, actions, children }: Props = $props();

	const hasHeader = $derived(!!(title || icon || title_ || actions || description));
</script>

<section class="py-6 first:pt-0 last:pb-0">
	{#if hasHeader}
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0 space-y-0.5">
				{#if title_}
					{@render title_()}
				{:else}
					<div class="flex items-center gap-2">
						{#if icon}
							<AppIcon name={icon} class="size-4 shrink-0 text-primary-500" />
						{/if}
						<h2 class="text-sm font-semibold">{title}</h2>
					</div>
				{/if}
				{#if description}
					<p class="max-w-prose text-xs text-surface-600-400">{description}</p>
				{/if}
			</div>
			{#if actions}
				<div class="flex shrink-0 items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}

	{#if children}
		<div class={hasHeader ? 'mt-4' : ''}>
			{@render children()}
		</div>
	{/if}
</section>
