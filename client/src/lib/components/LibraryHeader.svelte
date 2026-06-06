<script lang="ts">
	import type { Snippet } from 'svelte';
	import LibraryBreadcrumb from '$lib/components/LibraryBreadcrumb.svelte';

	/**
	 * The shared chrome at the top of every library tab: an emoji prefix + the
	 * breadcrumb heading (row 1) and the tabs (default `children` snippet, row 2).
	 * The library name and emoji are display-only here — renaming and emoji editing
	 * live on the Settings tab.
	 *
	 * `hideHeading` drops the breadcrumb row entirely (tabs stay) so a tab can
	 * reclaim the vertical space — the timeline's full-bleed gallery uses this.
	 */
	interface Props {
		libraryId: string;
		name?: string;
		emoji?: string | null;
		hideHeading?: boolean;
		/** The tabs row (was the default slot). */
		children?: Snippet;
		/** Trailing controls in the heading row (was the `actions` slot). */
		actions?: Snippet;
	}

	let { libraryId, name, emoji, hideHeading = false, children, actions }: Props = $props();
</script>

<div>
	{#if !hideHeading}
		<div class="flex min-h-12 items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-2">
				{#if emoji}
					<span class="shrink-0 text-2xl leading-none">{emoji}</span>
				{/if}
				<LibraryBreadcrumb {libraryId} libraryName={name} />
			</div>
			{#if actions}
				<div class="flex shrink-0 items-center gap-3">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}
	{#if children}
		<div class={hideHeading ? '' : 'mt-3'}>
			{@render children()}
		</div>
	{/if}
</div>
