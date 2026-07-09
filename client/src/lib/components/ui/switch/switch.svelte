<script lang="ts">
	import { Switch as SwitchPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		size = 'default',
		...restProps
	}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
		size?: 'sm' | 'default';
	} = $props();
</script>

<!--
	Deviations from vendored default (alcoves rework, documented):

	1. STATE VARIANTS FIXED (`data-checked:` → `data-[state=checked]:`): the
	   registry classes target bare `data-checked`/`data-unchecked` attributes,
	   but the installed bits-ui (2.18.x) Switch emits ONLY
	   `data-state="checked" | "unchecked"` (see dist/bits/switch/switch.svelte.js
	   → getDataChecked). Tailwind's `data-checked:` variant compiles to a
	   `[data-checked]` presence selector, so with the registry classes NO
	   state-dependent style ever applied — no track background in either state
	   and no thumb translation (only the thumb dot + shadow rendered). All
	   state variants below use `data-[state=…]:` to match the real attribute.

	2. UNCHECKED TRACK CONTRAST (design review): the registry's unchecked track
	   (`bg-input`, dimmed `/80` in dark) is near-invisible against `bg-card` in
	   both themes. Swapped to `bg-muted-foreground/30` with a matching
	   `border-muted-foreground/40` — `--muted-foreground` already carries
	   per-theme contrast tuning, so no `dark:` override is needed (semantic
	   tokens only, per rewrite conventions).
-->
<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	data-size={size}
	class={cn(
		'peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] data-[state=checked]:bg-primary data-[state=unchecked]:border-muted-foreground/40 data-[state=unchecked]:bg-muted-foreground/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Thumb
		data-slot="switch-thumb"
		class="pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-[state=checked]:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[calc(100%-2px)] group-data-[size=default]/switch:data-[state=unchecked]:translate-x-0 group-data-[size=sm]/switch:data-[state=unchecked]:translate-x-0 rtl:data-[state=checked]:translate-x-[calc(-100%)] dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
	/>
</SwitchPrimitive.Root>
