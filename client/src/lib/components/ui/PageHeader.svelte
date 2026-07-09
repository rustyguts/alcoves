<script lang="ts">
	/**
	 * PageHeader — the single page-title treatment for top-level routes.
	 *
	 * One `<h1>` scale (`text-2xl font-semibold`) + an optional muted description and
	 * right-pinned `actions`, so every standalone screen's header looks the same
	 * instead of each route hand-rolling its own size/weight (the survey found five
	 * different page-title treatments). Library sub-tabs use `LibraryHeader` /
	 * the breadcrumb instead — reach for this on the standalone routes (admin,
	 * profile, search, notifications, tags, objects, people, …).
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		/** Right-pinned header actions (buttons, badges). */
		actions?: Snippet;
	}

	let { title, description, actions }: Props = $props();
</script>

<div class="flex items-start justify-between gap-4">
	<div class="min-w-0 space-y-0.5">
		<h1 class="text-2xl font-semibold">{title}</h1>
		{#if description}
			<p class="text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex shrink-0 items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
