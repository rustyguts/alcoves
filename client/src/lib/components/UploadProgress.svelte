<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import { formatFileSize } from '$lib/utils/mime-icons';
	import { uploadQueue } from '$lib/state/upload-queue.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	let expanded = $state(true);
</script>

{#if uploadQueue.hasActiveUploads}
	<div
		class="fixed right-4 bottom-4 z-50 w-96 overflow-hidden rounded-xl border border-surface-300-700 bg-surface-50-950 shadow-xl"
	>
		<button
			type="button"
			class="flex w-full items-center justify-between bg-surface-100-900 px-4 py-2.5 text-left select-none"
			onclick={() => (expanded = !expanded)}
		>
			<span class="text-sm font-medium">
				Uploading {uploadQueue.activeUploads.length}
				{uploadQueue.activeUploads.length === 1 ? 'file' : 'files'}
			</span>
			<div class="flex items-center gap-2">
				{#if uploadQueue.uploadSpeed > 0}
					<span class="text-xs opacity-60">{formatFileSize(uploadQueue.uploadSpeed)}/s</span>
				{/if}
				<AppIcon name={expanded ? ICONS.chevronDown : ICONS.chevronUp} class="size-4 opacity-60" />
			</div>
		</button>

		{#if expanded && uploadQueue.erroredUploads.length > 0}
			<div class="flex items-center justify-between border-t border-surface-300-700 px-4 py-1.5">
				<span class="text-xs text-error-500">{uploadQueue.erroredUploads.length} failed</span>
				<div class="flex gap-1">
					<button
						type="button"
						class="btn preset-tonal btn-sm"
						onclick={() => uploadQueue.retryAll()}
					>
						Retry All
					</button>
					<button
						type="button"
						class="btn preset-tonal-error btn-sm"
						onclick={() => uploadQueue.clearErrors()}
					>
						Clear
					</button>
				</div>
			</div>
		{/if}

		{#if expanded}
			<div class="max-h-64 space-y-1 overflow-y-auto px-2 py-2">
				{#each uploadQueue.activeUploads as item (item.id)}
					<div class="rounded-lg bg-surface-100-900/60 px-2 py-2">
						<div class="mb-1 flex items-center justify-between">
							<span class="mr-2 flex-1 truncate text-sm">{item.file.name}</span>
							<span class="text-xs whitespace-nowrap opacity-60">{item.libraryName}</span>
						</div>

						{#if item.status === 'uploading'}
							<div class="flex items-center gap-2">
								<div
									class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-300-700"
									role="progressbar"
									aria-valuenow={item.progress}
									aria-valuemin={0}
									aria-valuemax={100}
								>
									<div
										class="h-full rounded-full bg-primary-500 transition-[width] duration-150"
										style:width="{item.progress}%"
									></div>
								</div>
								<span class="w-8 text-right text-xs opacity-60">{item.progress}%</span>
							</div>
						{:else if item.status === 'error'}
							<div class="flex items-center justify-between">
								<span class="text-xs text-error-500">{item.error}</span>
								<div class="flex gap-1">
									<button
										type="button"
										class="btn preset-tonal btn-sm"
										onclick={() => uploadQueue.retryFile(item.id)}
									>
										Retry
									</button>
									<button
										type="button"
										class="btn preset-tonal-error btn-sm"
										onclick={() => uploadQueue.removeFile(item.id)}
									>
										Remove
									</button>
								</div>
							</div>
						{:else if item.status === 'done'}
							<div class="flex items-center gap-1">
								<AppIcon name={ICONS.check} class="size-4 text-success-500" />
								<span class="text-xs text-success-500">Complete</span>
							</div>
						{:else}
							<div class="text-xs opacity-60">Waiting...</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
