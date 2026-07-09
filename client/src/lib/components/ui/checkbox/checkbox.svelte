<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<!--
	Deviation from vendored default (alcoves rework): the registry classes used
	bare `data-checked:` variants (`[data-checked]` presence selectors), but the
	installed bits-ui (2.18.x) Checkbox emits ONLY
	`data-state="checked" | "unchecked" | "indeterminate"` (see
	dist/bits/checkbox/checkbox.svelte.js → getCheckboxDataState), so the checked
	fill/border/text styles never applied — a checked box rendered as an unfilled
	square with a foreground-colored glyph. Rewritten to `data-[state=checked]:`
	to match the real attribute (same fix as ui/switch).
-->
<CheckboxPrimitive.Root
	bind:ref
	data-slot="checkbox"
	class={cn(
		'peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-shadow outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary',
		className
	)}
	bind:checked
	bind:indeterminate
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		<div
			data-slot="checkbox-indicator"
			class="grid place-content-center text-current transition-none [&>svg]:size-3.5"
		>
			{#if checked}
				<CheckIcon />
			{:else if indeterminate}
				<MinusIcon />
			{/if}
		</div>
	{/snippet}
</CheckboxPrimitive.Root>
