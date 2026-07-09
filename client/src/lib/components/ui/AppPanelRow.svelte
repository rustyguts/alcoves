<script lang="ts">
	/**
	 * AppPanelRow — a label/description pair on the left, a control on the right.
	 *
	 * The recurring settings row. `min-w-0` + the right column's `shrink-0` keep
	 * long descriptions wrapping instead of shoving the control off-screen, and
	 * the text block grows the row rather than clipping. Borderless — rows
	 * inside an AppPanel/well are separated by whitespace, not
	 * `<Separator>`/`border-b`. Comfortable `py-2.5` rhythm compensates for the
	 * dropped dividers. Not itself a click target: the right column always
	 * holds a real interactive control (Switch/Button/Select), and nesting a
	 * `role="button"` row around another interactive element is its own a11y
	 * anti-pattern — a fully row-clickable list uses a real `<a>`/`<button>`
	 * wrapper instead (see NotificationItem for that idiom).
	 */
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		title: string;
		description?: string;
		/** Render the title in the destructive color (danger-zone rows). */
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
	class={cn(
		'flex flex-col gap-3 rounded-lg px-3 py-2.5 sm:flex-row sm:justify-between sm:gap-4',
		align === 'center' ? 'sm:items-center' : 'sm:items-start'
	)}
>
	<div class="min-w-0 space-y-0.5">
		<p class={cn('text-sm font-medium', danger ? 'text-destructive' : 'text-foreground')}>
			{title}
		</p>
		{#if description}
			<p class="text-xs text-muted-foreground">{description}</p>
		{/if}
		{@render descriptionExtra?.()}
	</div>
	<div class="shrink-0">
		{@render children?.()}
	</div>
</div>
