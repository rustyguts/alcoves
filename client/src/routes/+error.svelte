<script lang="ts">
	import { page } from '$app/state';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? 'Something went wrong.');
</script>

<div class="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
	<p class="text-6xl font-bold text-primary-500">{status}</p>
	<h1 class="h2">
		{status === 404 ? 'Page not found' : 'Something went wrong'}
	</h1>
	<p class="max-w-md opacity-75">{message}</p>
	<a href="/" class="btn preset-filled-primary-500">Back to Alcoves</a>
</div>
