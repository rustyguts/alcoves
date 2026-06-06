<script module lang="ts">
	import { addCollection } from '@iconify/svelte';
	import lineicons from '@iconify-json/lineicons/icons.json';
	import type { IconifyJSON } from '@iconify/svelte';

	// Register the bundled Lineicons set so every icon renders fully OFFLINE — no
	// requests to the Iconify API (privacy-first, per the project vision). Runs once
	// on first import, on both the server (SSR) and the client.
	addCollection(lineicons as IconifyJSON);
</script>

<script lang="ts">
	import Icon from '@iconify/svelte';

	interface Props {
		/** An ICONS registry value, e.g. `lineicons:xmark`. */
		name: string;
		class?: string;
		width?: string | number;
		height?: string | number;
	}

	let { name, ...rest }: Props = $props();
</script>

<Icon icon={name} {...rest} />
