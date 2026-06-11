<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { Toast } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/state/toast';
	import { theme } from '$lib/state/theme.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Seed/sync the auth store from the server-resolved user.
	$effect(() => {
		auth.setUser(data.user ?? null);
	});

	onMount(() => {
		theme.init();
		// App is interactive: release the pre-hydration native-form-submit guard.
		window.__alcovesReady = true;
		window.__alcovesReleaseFormGuard?.();
	});
</script>

{@render children()}

<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast {toast}>
			<Toast.Message>
				<Toast.Title>{toast.title}</Toast.Title>
				<Toast.Description>{toast.description}</Toast.Description>
			</Toast.Message>
			<Toast.CloseTrigger />
		</Toast>
	{/snippet}
</Toast.Group>
