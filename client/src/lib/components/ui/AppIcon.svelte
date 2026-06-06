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
		/**
		 * Default icon size, applied ONLY when no explicit `size-*` / `w-*` / `h-*`
		 * class is passed. Existing call sites all pass an explicit `size-*` class,
		 * so they keep full control and render identically; new call sites can omit
		 * `class` and inherit this default. `none` opts out entirely.
		 */
		size?: 'sm' | 'md' | 'lg' | 'none';
		class?: string;
		width?: string | number;
		height?: string | number;
	}

	let { name, size = 'md', class: klass = '', width, height, ...rest }: Props = $props();

	const DEFAULT_SIZE = { sm: 'size-3.5', md: 'size-4', lg: 'size-5', none: '' } as const;

	const hasExplicitSize = $derived(/(?:^|\s)(?:size|w|h)-/.test(klass));
	const sizeClass = $derived(hasExplicitSize ? '' : DEFAULT_SIZE[size]);
	const mergedClass = $derived([sizeClass, klass].filter(Boolean).join(' '));
</script>

<Icon icon={name} class={mergedClass} {width} {height} {...rest} />
