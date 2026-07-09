<script lang="ts">
	/**
	 * SettingsSection — a titled Card used to group one settings concern
	 * (name, a feature toggle, danger zone, …) on the library settings page.
	 *
	 * Composes the vendored `Card.*` primitives: an icon + title + description
	 * header (or a fully custom `title_` snippet), an `actions` row pinned to the
	 * header, and the section body in `Card.Content`. Stack a column of these with
	 * `gap-6` and the page reads as a list of self-contained cards.
	 *
	 * Flat redesign (.agents/specs/shadcn-rewrite/08-flat-redesign.md): the
	 * elevated-sheet Card (borderless, `shadow-xs` by default — R8
	 * flat-redesign-fixes review) is the ONE per-context choice for all
	 * library settings sections; don't mix this with the well pattern on this
	 * page.
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import * as Card from '$lib/components/ui/card/index.js';

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

<Card.Root>
	{#if hasHeader}
		<Card.Header>
			{#if title_}
				{@render title_()}
			{:else}
				<Card.Title role="heading" aria-level={2} class="flex items-center gap-2">
					{#if icon}
						<AppIcon name={icon} class="size-4 shrink-0 text-primary" />
					{/if}
					<span>{title}</span>
				</Card.Title>
			{/if}
			{#if description}
				<Card.Description>{description}</Card.Description>
			{/if}
			{#if actions}
				<Card.Action class="flex items-center gap-2">
					{@render actions()}
				</Card.Action>
			{/if}
		</Card.Header>
	{/if}

	{#if children}
		<Card.Content>
			{@render children()}
		</Card.Content>
	{/if}
</Card.Root>
