<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		showTrashed: boolean;
		title: string;
		description: string;
		canManageLibrary: boolean;
		oncreateFolder?: () => void;
		onuploadFiles?: () => void;
	}

	let { showTrashed, title, description, canManageLibrary, oncreateFolder, onuploadFiles }: Props =
		$props();
</script>

{#snippet emptyActions()}
	<Button variant="outline" onclick={() => oncreateFolder?.()}>
		<AppIcon name={ICONS.folder} class="size-4" />
		<span>Create folder</span>
	</Button>
	<Button variant="secondary" onclick={() => onuploadFiles?.()}>
		<AppIcon name={ICONS.upload} class="size-4" />
		<span>Upload files</span>
	</Button>
{/snippet}

<EmptyState
	icon={showTrashed ? ICONS.trash : ICONS.folder}
	{title}
	{description}
	actions={canManageLibrary && !showTrashed ? emptyActions : undefined}
/>
