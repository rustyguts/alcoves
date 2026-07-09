<script lang="ts">
	// Deviation (alcoves rework): bare `data-open:`/`data-closed:` variants never matched — installed bits-ui 2.18.x emits `data-state="open|closed"`, not bare attributes; rewritten to `data-[state=...]:` so open/close animations actually run. Full analysis: ui/switch/switch.svelte.
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	bind:ref
	data-slot="dialog-overlay"
	class={cn(
		'fixed inset-0 isolate z-50 bg-black/10 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 supports-backdrop-filter:backdrop-blur-xs',
		className
	)}
	{...restProps}
/>
