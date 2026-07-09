<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AdminJobsPanel from '$lib/components/admin/AdminJobsPanel.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-0.5">
	<Button href="/admin" variant="secondary" size="sm" class="self-start">
		<AppIcon name={ICONS.back} class="size-4" />
		Back to Admin
	</Button>

	<AdminJobsPanel />
</div>
