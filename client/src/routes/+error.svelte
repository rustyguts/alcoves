<script lang="ts">
	/**
	 * Root error boundary — catches anything thrown outside a more specific
	 * boundary (e.g. the authed `(app)` shell has its own). Renders as a fully
	 * standalone page (no app chrome), so it must read well on its own in both
	 * themes for public/pre-auth routes too.
	 */
	import { page } from '$app/state';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	const status = $derived(page.status);
	const isNotFound = $derived(status === 404);
	const message = $derived(page.error?.message ?? 'Something went wrong.');
</script>

<div class="flex min-h-svh flex-col items-center justify-center bg-background p-4">
	<Card.Root class="w-full max-w-md text-center">
		<Card.Content class="flex flex-col items-center gap-3">
			<div class="inline-flex rounded-full bg-primary/10 p-3 text-primary">
				<AppIcon name={isNotFound ? ICONS.search : ICONS.warning} class="size-6" />
			</div>
			<p class="text-5xl font-bold text-primary">{status}</p>
			<h1 class="text-xl font-semibold">
				{isNotFound ? 'Page not found' : 'Something went wrong'}
			</h1>
			<p class="text-sm text-muted-foreground">{message}</p>
			<Button href="/" class="mt-2">Back to Alcoves</Button>
		</Card.Content>
	</Card.Root>
</div>
