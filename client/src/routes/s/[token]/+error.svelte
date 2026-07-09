<script lang="ts">
	/**
	 * Error boundary for public moment-share pages. Theme-aware chrome matching
	 * the share landing; covers the 404 thrown by s/[token]/+page.server.ts when a
	 * share token is unknown or expired.
	 */
	import { page } from '$app/state';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	const status = $derived(page.status);
	const isNotFound = $derived(status === 404);
	const message = $derived(
		page.error?.message ??
			(isNotFound ? 'This shared moment is no longer available.' : 'Something went wrong.')
	);
</script>

<div
	class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground"
>
	<span class="text-sm font-bold tracking-tight text-muted-foreground">
		Alcoves · shared moment
	</span>
	<!-- App's one empty-state motif (EmptyState.svelte): rounded-full muted icon
		 badge + heading + muted text. Kept minimal/public — no CTA, same as
		 before (this page still has no follow-up action to offer). -->
	<div class="inline-flex rounded-full bg-muted p-3 text-muted-foreground">
		<AppIcon name={isNotFound ? ICONS.search : ICONS.warning} class="size-6" />
	</div>
	<p class="text-5xl font-bold text-primary">{status}</p>
	<h1 class="text-xl font-semibold">
		{isNotFound ? 'Moment not found' : 'Something went wrong'}
	</h1>
	<p class="max-w-md text-sm text-muted-foreground">{message}</p>
</div>
