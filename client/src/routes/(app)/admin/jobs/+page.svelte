<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AdminJobsPanel from '$lib/components/admin/AdminJobsPanel.svelte';
</script>

<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-0.5">
	<a href="/admin" class="btn self-start preset-tonal-surface btn-sm">
		<AppIcon name={ICONS.back} class="size-4" />
		Back to Admin
	</a>

	<AdminJobsPanel />
</div>
