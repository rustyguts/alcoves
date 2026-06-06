<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
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

<nav aria-label="Breadcrumb" class="min-w-0">
	<ol class="flex min-w-0 flex-nowrap items-center">
		{#each crumbs as crumb, index (crumb.to)}
			{#if index > 0}
				<li aria-hidden="true" class="mx-1 shrink-0 text-surface-400 sm:mx-1.5">
					<AppIcon name={ICONS.chevronRight} class="size-4 sm:size-5" />
				</li>
			{/if}
			<li class="min-w-0">
				{#if index === lastIndex}
					<span
						aria-current="page"
						class="block truncate text-lg font-semibold text-surface-950
							sm:max-w-xs sm:text-xl dark:text-surface-50"
					>
						{crumb.label}
					</span>
				{:else}
					<a
						href={crumb.to}
						class="block truncate text-lg font-medium text-surface-500
							transition-colors hover:text-surface-950 sm:max-w-xs
							sm:text-xl dark:hover:text-surface-50"
					>
						{crumb.label}
					</a>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
