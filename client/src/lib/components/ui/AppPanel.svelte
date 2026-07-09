<script lang="ts">
	/**
	 * AppPanel — the single, consistent "titled section" used across the app.
	 *
	 * Flat redesign (.agents/specs/shadcn-rewrite/08-flat-redesign.md): no
	 * outer border/card box. The header sits plain on the page canvas — an
	 * optional icon + `text-sm font-medium` title, an optional muted
	 * description, and an `actions` snippet pinned to the right. The BODY is
	 * the one layered surface: a borderless `bg-muted/50 rounded-xl` well.
	 * `flush` only strips the well's padding (for tables / full-bleed lists
	 * that manage their own spacing); `bodyClass` replaces the well entirely
	 * (e.g. for a bare, unstyled list) — same "takes precedence" contract as
	 * before, just with a well as the new default instead of a bordered card.
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { cn } from '$lib/utils';

	interface Props {
		title?: string;
		description?: string;
		/** An ICONS registry value, e.g. `lineicons:cog`. */
		icon?: string;
		/** Remove the well's padding — for tables / full-bleed lists. */
		flush?: boolean;
		/** Replace the body's classes entirely (takes precedence over `flush`). */
		bodyClass?: string;
		/** Replaces the default icon + title row. */
		title_?: Snippet;
		/** Right-pinned header actions. */
		actions?: Snippet;
		/** Panel body. */
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
	const bodyUi = $derived(bodyClass ?? cn('rounded-xl bg-muted/50', flush ? 'p-0' : 'p-4'));
</script>

<div data-slot="app-panel" class="flex flex-col gap-3">
	{#if hasHeader}
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0 space-y-0.5">
				{#if title_}
					{@render title_()}
				{:else}
					<div class="flex items-center gap-2">
						{#if icon}
							<AppIcon name={icon} class="size-4 shrink-0 text-primary" />
						{/if}
						<h2 class="text-sm font-medium">{title}</h2>
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
