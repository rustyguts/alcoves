<script lang="ts">
	/**
	 * EmptyState — the one "nothing here" treatment.
	 *
	 * A tinted round icon badge, a title, an optional muted description, and an
	 * optional `actions` CTA row. Generalises the gold-standard `LibraryEmptyState`
	 * pattern so every empty / zero-result / load-error view looks the same instead
	 * of each route hand-rolling a bare one-liner. Pass `tone="error"` to surface a
	 * failed load (distinct from a genuinely-empty result).
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		/** An ICONS registry value. */
		icon: string;
		title: string;
		description?: string;
		tone?: 'neutral' | 'error';
		/** Optional CTA row rendered under the description. */
		actions?: Snippet;
	}

	let { icon, title, description, tone = 'neutral', actions }: Props = $props();

	const badgeClass = $derived(
		tone === 'error' ? 'bg-error-500/10 text-error-500' : 'bg-surface-200-800 text-surface-500'
	);
</script>

<div class="flex flex-col items-center justify-center px-4 py-16 text-center">
	<div class={['mb-4 flex size-16 items-center justify-center rounded-full', badgeClass]}>
		<AppIcon name={icon} class="size-8" />
	</div>
	<p class="text-lg font-medium">{title}</p>
	{#if description}
		<p class="mt-1 max-w-sm text-sm text-surface-600-400">{description}</p>
	{/if}
	{#if actions}
		<div class="mt-4 flex items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
