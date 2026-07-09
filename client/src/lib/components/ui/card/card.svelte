<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: 'default' | 'sm' } = $props();
</script>

<!--
	Documented deviation from the upstream shadcn-svelte "vega" registry source
	(same precedent as the vendored switch/sonner edits): upstream ships
	`ring-1 ring-foreground/10` + `overflow-hidden`. The ring drew a permanent
	1px hairline that a call-site `class="border-0 shadow-xs"` override could
	never strip (border-* and ring-* are different Tailwind conflict groups),
	splitting the "elevated sheet" idiom across the app; `overflow-hidden`
	hard-clipped in-flow content (profile Appearance/Account/Connected-apps
	panels) instead of only clipping the first/last `<img>` corner case, which
	is handled directly via the `*:[img:...]:rounded-*` selectors below. See
	.agents/specs/shadcn-rewrite/08-flat-redesign.md (P1 final idioms:
	"Elevated sheet") and the R8 flat-redesign-fixes rework review. Card is now
	borderless + shadow-xs by default — callers no longer need a
	`border-0 shadow-xs` override.
-->
<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	class={cn(
		'group/card flex flex-col gap-(--card-spacing) rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground shadow-xs [--card-spacing:--spacing(6)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
