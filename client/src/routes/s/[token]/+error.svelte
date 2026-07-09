<script lang="ts">
	/**
	 * Error boundary for public moment-share pages. Theme-aware chrome matching
	 * the share landing; covers the 404 thrown by s/[token]/+page.server.ts when a
	 * share token is unknown or expired.
	 */
	import { page } from '$app/state';

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
	<p class="text-5xl font-bold text-primary">{status}</p>
	<h1 class="text-xl font-semibold">
		{isNotFound ? 'Moment not found' : 'Something went wrong'}
	</h1>
	<p class="max-w-md text-sm text-muted-foreground">{message}</p>
</div>
