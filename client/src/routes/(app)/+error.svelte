<script lang="ts">
	/**
	 * Error boundary for the authed app: renders INSIDE the dashboard shell (the
	 * sidebar/header chrome stays, since +error replaces only the page slot). A 404
	 * thrown from a library/page load surfaces here cleanly framed by the app.
	 */
	import { page } from '$app/state';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	const status = $derived(page.status);
	const isNotFound = $derived(status === 404);
	const message = $derived(page.error?.message ?? 'Something went wrong.');
</script>

<div class="flex min-h-0 flex-1 items-center justify-center p-4">
	<Card tone="tonal" padding="lg" class="w-full max-w-md text-center">
		<div class="flex flex-col items-center gap-3">
			<div class="grid size-12 place-items-center rounded-full preset-tonal-primary">
				<AppIcon name={isNotFound ? ICONS.search : ICONS.warning} class="size-6" />
			</div>
			<p class="text-5xl font-bold text-primary-500">{status}</p>
			<h1 class="text-xl font-semibold">
				{isNotFound ? 'Page not found' : 'Something went wrong'}
			</h1>
			<p class="text-sm text-surface-600-400">{message}</p>
			<div class="mt-2 flex items-center gap-2">
				<Button href="/" variant="tonal" color="surface">
					{#snippet icon()}<AppIcon name={ICONS.back} />{/snippet}
					Home
				</Button>
				<Button href={page.url.pathname} data-sveltekit-reload>Try again</Button>
			</div>
		</div>
	</Card>
</div>
