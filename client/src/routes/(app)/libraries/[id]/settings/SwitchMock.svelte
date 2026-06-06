<script lang="ts">
	// Lightweight stand-in for the skeleton-svelte `Switch` root used only in unit
	// tests. The real widget renders a zag-driven label + hidden input that can't
	// be toggled in a headless unit env (no layout/visibility), so we render a
	// plain `role="switch"` button that invokes `onCheckedChange` on click.
	interface Props {
		checked?: boolean;
		disabled?: boolean;
		onCheckedChange?: (e: { checked: boolean }) => void;
		children?: import('svelte').Snippet;
	}
	let { checked = false, disabled = false, onCheckedChange, children }: Props = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	{disabled}
	onclick={() => onCheckedChange?.({ checked: !checked })}
>
	{@render children?.()}
</button>
