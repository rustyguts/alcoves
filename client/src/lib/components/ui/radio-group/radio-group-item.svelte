<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<!--
	Deviation from vendored default (alcoves rework): the registry classes used
	bare `data-checked:` variants (`[data-checked]` presence selectors), but the
	installed bits-ui (2.18.x) RadioGroup.Item emits ONLY
	`data-state="checked" | "unchecked"` (see
	dist/bits/radio-group/radio-group.svelte.js), so the checked fill never
	applied — and since the indicator dot is `bg-primary-foreground` (white in
	light theme), the selected radio was nearly invisible on the unfilled track.
	Rewritten to `data-[state=checked]:` to match the real attribute (same fix
	as ui/switch).
-->
<RadioGroupPrimitive.Item
	bind:ref
	data-slot="radio-group-item"
	class={cn(
		'group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		<div data-slot="radio-group-indicator" class="flex size-4 items-center justify-center">
			{#if checked}
				<CircleIcon
					class="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground"
				/>
			{/if}
		</div>
	{/snippet}
</RadioGroupPrimitive.Item>
