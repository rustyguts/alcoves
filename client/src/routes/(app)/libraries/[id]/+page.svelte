<script lang="ts">
	import LibraryBrowser from './LibraryBrowser.svelte';
	import type { PageProps } from './$types';

	/**
	 * The library file browser (Files view). `data.library` comes from the
	 * /libraries/[id] subtree's server load and `data.user` from the authed shell;
	 * the heavy browser logic lives in the shared LibraryBrowser component, which
	 * the /trash route renders with `trashed`.
	 */
	let { data }: PageProps = $props();
</script>

<LibraryBrowser library={data.library} user={data.user} />
