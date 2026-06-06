<script lang="ts">
	/**
	 * AppPanelRow — a label/description pair on the left, a control on the right.
	 *
	 * The recurring settings row. `min-w-0` + the right column's `shrink-0` keep
	 * long descriptions wrapping instead of shoving the control off-screen, and
	 * the text block grows the row rather than clipping.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		/** Render the title in the error color (danger-zone rows). */
		danger?: boolean;
		/** Vertically center the control against the text (default) or top-align it. */
		align?: 'center' | 'start';
		/** Extra description content rendered below the text (was the `description` slot). */
		descriptionExtra?: Snippet;
		/** The control rendered on the right (was the default slot). */
		children?: Snippet;
	}

	let {
		title,
		description,
		danger = false,
		align = 'center',
		descriptionExtra,
		children
	}: Props = $props();
</script>

<div
	class="flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4"
	class:sm:items-center={align === 'center'}
	class:sm:items-start={align === 'start'}
>
	<div class="min-w-0 space-y-0.5">
		<p
			class="text-sm font-medium"
			class:text-error-500={danger}
			class:text-surface-950-50={!danger}
		>
			{title}
		</p>
		{#if description}
			<p class="text-xs text-surface-600-400">{description}</p>
		{/if}
		{@render descriptionExtra?.()}
	</div>
	<div class="shrink-0">
		{@render children?.()}
	</div>
</div>
