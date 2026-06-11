<script lang="ts">
	// Passthrough stand-in for `Switch.Control` / `Switch.Thumb` — just renders its
	// children so the page markup stays valid under the mocked Switch.
	let { children }: { children?: import('svelte').Snippet } = $props();
</script>

{@render children?.()}
