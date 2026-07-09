<script lang="ts">
	import AppModal from '$lib/components/ui/AppModal.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ICONS } from '$lib/utils/icons';
	import { uploadQueue } from '$lib/state/upload-queue.svelte';

	/**
	 * Upload dialog. Picks files via a native multi-file input and queues them
	 * onto the global TUS upload queue, then closes. Ported from the Nuxt
	 * `UploadModal.vue` — two-way bindable `open`, clears its selection whenever
	 * the modal closes.
	 */

	interface Props {
		libraryId: string;
		libraryName: string;
		parentFolderId: string | null;
		/** Controlled visibility (two-way bindable). */
		open?: boolean;
	}

	let { libraryId, libraryName, parentFolderId, open = $bindable(false) }: Props = $props();

	let selectedFiles = $state<File[]>([]);
	const selectedFileCount = $derived(selectedFiles.length);

	function handleUpload() {
		if (!selectedFileCount) return;
		uploadQueue.addFiles(selectedFiles, libraryId, libraryName, parentFolderId);
		selectedFiles = [];
		open = false;
	}

	function onFileChange(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files) {
			selectedFiles = Array.from(target.files);
		}
	}

	// Mirror the Vue `watch(open)`: clear the selection whenever the modal closes.
	$effect(() => {
		if (!open) selectedFiles = [];
	});
</script>

<AppModal bind:open title="Upload Files">
	<div class="flex flex-col gap-3">
		<p class="text-sm text-muted-foreground">
			Uploading to <strong class="font-medium text-foreground">{libraryName}</strong>
		</p>

		<Input type="file" multiple onchange={onFileChange} />

		{#if selectedFileCount}
			<p class="text-sm text-muted-foreground">
				{selectedFileCount} file{selectedFileCount === 1 ? '' : 's'} selected
			</p>
		{/if}
	</div>

	<div class="flex w-full justify-end gap-2">
		<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button disabled={!selectedFileCount} onclick={handleUpload}>
			<AppIcon name={ICONS.upload} class="size-4" />
			<span>Upload</span>
		</Button>
	</div>
</AppModal>
