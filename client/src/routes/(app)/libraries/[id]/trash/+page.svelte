<script lang="ts">
	import LibraryBrowser from '../LibraryBrowser.svelte';
	import type { PageProps } from './$types';

	/**
	 * The library Trash view — the old Nuxt `/libraries/:id/trash` route alias. It
	 * renders the same shared LibraryBrowser as the Files page, with `trashed` set
	 * so it lists soft-deleted entries and surfaces restore / permanent-delete.
	 */
	let { data }: PageProps = $props();
</script>

<LibraryBrowser library={data.library} user={data.user} trashed />
