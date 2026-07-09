<script lang="ts">
	/**
	 * AppPanel — the single, consistent "titled card section" used across the app.
	 *
	 * One header treatment everywhere: an optional icon + `text-sm font-semibold`
	 * title, an optional muted description, and an `actions` snippet pinned to the
	 * right. The default children are the card body. A lightweight card surface
	 * (`bg-card` + `border`) rather than the full `Card` composition.
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		title?: string;
		description?: string;
		/** An ICONS registry value, e.g. `lineicons:cog`. */
		icon?: string;
		/** Remove body padding — for tables / full-bleed lists. */
		flush?: boolean;
		/** Override body padding (takes precedence over `flush`). */
		bodyClass?: string;
		/** Replaces the default icon + title row. */
		title_?: Snippet;
		/** Right-pinned header actions. */
		actions?: Snippet;
		/** Card body. */
		children?: Snippet;
	}

	let {
		title,
		description,
		icon,
		flush = false,
		bodyClass,
		title_,
		actions,
		children
	}: Props = $props();

	const hasHeader = $derived(!!(title || icon || title_ || actions || description));
	const bodyUi = $derived(bodyClass ? bodyClass : flush ? 'p-0' : 'p-4');
</script>

<div data-slot="app-panel" class="rounded-lg border bg-card text-card-foreground">
	{#if hasHeader}
		<div class="flex items-start justify-between gap-3 border-b p-4">
			<div class="min-w-0 space-y-0.5">
				{#if title_}
					{@render title_()}
				{:else}
					<div class="flex items-center gap-2">
						{#if icon}
							<AppIcon name={icon} class="size-4 shrink-0 text-primary" />
						{/if}
						<h2 class="text-sm font-semibold">{title}</h2>
					</div>
				{/if}
				{#if description}
					<p class="text-xs text-muted-foreground">{description}</p>
				{/if}
			</div>
			{#if actions}
				<div class="flex shrink-0 items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}

	<div data-slot="app-panel-body" class={bodyUi}>
		{@render children?.()}
	</div>
</div>
