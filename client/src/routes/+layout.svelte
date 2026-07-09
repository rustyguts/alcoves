<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
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

<Tooltip.Provider>
	{@render children()}
</Tooltip.Provider>

<Toaster richColors closeButton position="bottom-right" theme={theme.resolved} />
