<script lang="ts">
	// Deviation (alcoves rework): `data-open:` never matched (bits-ui emits data-state="open|closed") and `data-active:`/`peer-data-active` matched ALWAYS — Svelte stringifies the self-set boolean to data-active="false"/"true" and the presence selector matches both. Rewritten to `data-[state=open]:` / `data-[active=true]:`. Full analysis: ui/switch/switch.svelte.
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="sidebar-menu-badge"
	data-sidebar="menu-badge"
	class={cn(
		'pointer-events-none absolute right-1 flex flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
