<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

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

<div class="flex flex-col items-center justify-center px-4 py-16">
	<div class="mb-4 flex size-16 items-center justify-center rounded-full bg-surface-200-800">
		<AppIcon name={showTrashed ? ICONS.trash : ICONS.folder} class="size-8 text-surface-500" />
	</div>
	<p class="mb-1 text-lg font-medium">{title}</p>
	<p class="mb-4 text-sm text-surface-500">{description}</p>
	{#if canManageLibrary && !showTrashed}
		<div class="flex items-center gap-2">
			<button type="button" class="btn preset-tonal" onclick={() => oncreateFolder?.()}>
				<AppIcon name={ICONS.folder} class="size-4" />
				<span>Create folder</span>
			</button>
			<button type="button" class="btn preset-tonal-primary" onclick={() => onuploadFiles?.()}>
				<AppIcon name={ICONS.upload} class="size-4" />
				<span>Upload files</span>
			</button>
		</div>
	{/if}
</div>
