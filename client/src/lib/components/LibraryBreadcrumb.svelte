<script lang="ts">
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { libraryFolderPath } from '$lib/state/library-folder-path.svelte';

	/**
	 * The library page's primary heading: a breadcrumb whose root is the library
	 * name (links to the Files root) and whose tail is the current folder ancestry
	 * (only present on the Files tab, via the `libraryFolderPath` store). No leading
	 * home icon — the library name is the anchor. The current (last) crumb is the
	 * non-link "current page" and is styled as the heading.
	 */
	interface Props {
		libraryId: string;
		libraryName?: string;
	}

	interface Crumb {
		label: string;
		to: string;
	}

	let { libraryId, libraryName }: Props = $props();

	const crumbs = $derived.by<Crumb[]>(() => {
		const base = `/libraries/${libraryId}`;
		return [
			{ label: libraryName || 'Library', to: base },
			...libraryFolderPath.value.map((crumb) => ({
				label: crumb.name,
				to: `${base}?folder=${encodeURIComponent(crumb.id)}`
			}))
		];
	});

	const lastIndex = $derived(crumbs.length - 1);
</script>

<Breadcrumb.Root aria-label="Breadcrumb" class="min-w-0">
	<Breadcrumb.List class="flex-nowrap">
		{#each crumbs as crumb, index (crumb.to)}
			{#if index > 0}
				<Breadcrumb.Separator class="shrink-0" />
			{/if}
			<Breadcrumb.Item class="min-w-0">
				{#if index === lastIndex}
					<!-- Stock PageHeader h1 scale (text-2xl font-semibold) — this crumb
					     IS the page's primary heading on library sub-tabs. -->
					<Breadcrumb.Page
						class="block truncate text-2xl font-semibold text-foreground sm:max-w-xs"
					>
						{crumb.label}
					</Breadcrumb.Page>
				{:else}
					<Breadcrumb.Link
						href={crumb.to}
						class="block truncate text-2xl font-medium text-muted-foreground sm:max-w-xs"
					>
						{crumb.label}
					</Breadcrumb.Link>
				{/if}
			</Breadcrumb.Item>
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
