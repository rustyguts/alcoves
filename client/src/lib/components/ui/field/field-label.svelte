<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: ComponentProps<typeof Label> = $props();
</script>

<!--
	Deviation from vendored default (alcoves rework): the registry classes used
	`has-data-checked:` variants (`:has([data-checked])` selectors), but the
	installed bits-ui (2.18.x) form controls (Checkbox/RadioGroup.Item/Switch)
	emit ONLY `data-state="checked"`, never a bare `data-checked` attribute — so
	the checked-highlight card treatment never applied. Rewritten to
	`has-data-[state=checked]:` to match the real attribute (same fix as
	ui/switch).
-->
<Label
	bind:ref
	data-slot="field-label"
	class={cn(
		'group/field-label peer/field-label flex w-fit gap-2 leading-snug leading-snug group-data-[disabled=true]/field:opacity-50 has-data-[state=checked]:border-primary/30 has-data-[state=checked]:bg-primary/5 has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border *:data-[slot=field]:p-3 dark:has-data-[state=checked]:border-primary/20 dark:has-data-[state=checked]:bg-primary/10',
		'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</Label>
