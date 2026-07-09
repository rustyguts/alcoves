<script lang="ts">
	import { page } from '$app/state';
	import LibraryHeader from '$lib/components/LibraryHeader.svelte';
	import type { LayoutProps } from './$types';

	/**
	 * The shared chrome for every /libraries/[id] tab. Nests inside the authed
	 * dashboard shell ((app)/+layout.svelte) automatically, so it only renders the
	 * library header + the page slot. `data.library` comes from the subtree's
	 * server load and `page.params.id` is the library id — child pages read those
	 * directly (no provide/inject like the old Nuxt layout did).
	 */
	let { data, children }: LayoutProps = $props();

	const libraryId = $derived(page.params.id ?? '');

	// The timeline runs a full-bleed Google-Photos gallery; drop the breadcrumb row
	// (and tighten the shell spacing) so it reclaims the vertical space.
	const isTimeline = $derived(page.url.pathname.endsWith('/timeline'));
</script>

<div class="flex min-h-0 flex-1 flex-col" class:gap-2={isTimeline} class:gap-6={!isTimeline}>
	<LibraryHeader
		{libraryId}
		name={data.library?.name}
		emoji={data.library?.emoji}
		hideHeading={isTimeline}
	>
		{#snippet actions()}
			<!-- Portal target: library pages (e.g. Files) inject their toolbar here
			     so it shares the breadcrumb row instead of taking its own. -->
			<div id="library-header-actions" class="flex items-center gap-1.5"></div>
		{/snippet}
	</LibraryHeader>

	<div class="relative flex min-h-0 flex-1 flex-col">
		{@render children()}
	</div>
</div>
