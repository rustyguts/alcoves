<script lang="ts">
	// Deviation (alcoves rework): bare `data-open:`/`data-closed:` variants never matched — installed bits-ui 2.18.x emits `data-state="open|closed"`, not bare attributes; rewritten to `data-[state=...]:` so open/close animations actually run. Full analysis: ui/switch/switch.svelte.
	import { Select as SelectPrimitive } from 'bits-ui';
	import SelectPortal from './select-portal.svelte';
	import SelectScrollUpButton from './select-scroll-up-button.svelte';
	import SelectScrollDownButton from './select-scroll-down-button.svelte';
	import { cn, type WithoutChild } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';
	import type { WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		portalProps,
		children,
		preventScroll = true,
		...restProps
	}: WithoutChild<SelectPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SelectPortal>>;
	} = $props();
</script>

<SelectPortal {...portalProps}>
	<SelectPrimitive.Content
		bind:ref
		{sideOffset}
		{preventScroll}
		data-slot="select-content"
		class={cn(
			'relative isolate z-50 min-w-36 overflow-x-hidden overflow-y-auto rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
			className
		)}
		{...restProps}
	>
		<SelectScrollUpButton />
		<SelectPrimitive.Viewport
			class={cn(
				'h-(--bits-select-anchor-height) w-full min-w-(--bits-select-anchor-width) scroll-my-1'
			)}
		>
			{@render children?.()}
		</SelectPrimitive.Viewport>
		<SelectScrollDownButton />
	</SelectPrimitive.Content>
</SelectPortal>
