<script lang="ts">
	import AppModal from '$lib/components/ui/AppModal.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
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
		<p class="text-sm opacity-75">
			Uploading to <strong>{libraryName}</strong>
		</p>

		<input
			type="file"
			class="block w-full cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-surface-200-800 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-surface-300-700"
			multiple
			onchange={onFileChange}
		/>

		{#if selectedFileCount}
			<p class="text-sm opacity-75">
				{selectedFileCount} file{selectedFileCount === 1 ? '' : 's'} selected
			</p>
		{/if}
	</div>

	<div class="flex justify-end gap-2">
		<button type="button" class="btn preset-tonal" onclick={() => (open = false)}>Cancel</button>
		<button
			type="button"
			class="btn preset-filled-primary-500"
			disabled={!selectedFileCount}
			onclick={handleUpload}
		>
			<AppIcon name={ICONS.upload} class="size-4" />
			<span>Upload</span>
		</button>
	</div>
</AppModal>
