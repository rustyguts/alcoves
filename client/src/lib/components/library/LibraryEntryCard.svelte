<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryEntry, LibraryFile } from '$lib/types/api';
	import { apiUrl } from '$lib/api';
	import { formatDuration } from '$lib/utils/format-duration';
	import { getMimeIcon } from '$lib/utils/mime-icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AlcovesImage from '$lib/components/ui/AlcovesImage.svelte';

	interface Props {
		entry: LibraryEntry;
		libraryId: string;
		showTrashed: boolean;
		dragEnabled: boolean;
		draggedFileIds: string[];
		dropTargetFolderId: string | null;
		renameValue: string;
		isEntrySelected: (entry: LibraryEntry) => boolean;
		isRenaming: (entry: LibraryEntry) => boolean;
		failedThumbnails: Set<string>;
		isImageFile: (file: LibraryFile) => boolean;
		isSmallImage: (file: LibraryFile) => boolean;
		onrowClick?: (entry: LibraryEntry, event: MouseEvent) => void;
		onrowDoubleClick?: (entry: LibraryEntry) => void;
		onrowContextMenu?: (entry: LibraryEntry, event: MouseEvent) => void;
		ondragStart?: (entry: LibraryEntry, event: DragEvent) => void;
		ondragEnd?: () => void;
		ondragEnter?: (entry: LibraryEntry) => void;
		ondragOver?: (entry: LibraryEntry, event: DragEvent) => void;
		ondragLeave?: (entry: LibraryEntry, event: DragEvent) => void;
		ondrop?: (entry: LibraryEntry, event: DragEvent) => void;
		onsaveRename?: (entry: LibraryEntry) => void;
		oncancelRename?: () => void;
		onupdateRenameValue?: (value: string) => void;
		onthumbnailError?: (fileId: string) => void;
	}

	let {
		entry,
		libraryId,
		showTrashed,
		dragEnabled,
		draggedFileIds,
		dropTargetFolderId,
		renameValue,
		isEntrySelected,
		isRenaming,
		failedThumbnails,
		isImageFile,
		isSmallImage,
		onrowClick,
		onrowDoubleClick,
		onrowContextMenu,
		ondragStart,
		ondragEnd,
		ondragEnter,
		ondragOver,
		ondragLeave,
		ondrop,
		onsaveRename,
		oncancelRename,
		onupdateRenameValue,
		onthumbnailError
	}: Props = $props();

	// YouTube-style duration overlay, shown only for video files that carry a
	// known duration. null hides the badge (missing/zero-length/still-processing).
	const durationLabel = $derived(
		entry.kind === 'file' && entry.mimeType.startsWith('video/')
			? formatDuration(entry.duration)
			: null
	);

	const selected = $derived(isEntrySelected(entry));
	const renaming = $derived(isRenaming(entry));
	const isDropTarget = $derived(dropTargetFolderId === entry.id && entry.kind === 'folder');
	const isDragging = $derived(draggedFileIds.includes(entry.id) && entry.kind === 'file');

	const folderTitle = $derived(
		entry.kind === 'folder' && showTrashed
			? `${entry.name} (${entry.trashFileCount ?? 0} files)`
			: entry.name
	);
</script>

<div
	role="button"
	tabindex="0"
	class={[
		'cursor-pointer overflow-hidden rounded-md transition-colors select-none',
		selected
			? 'bg-primary-500/20 hover:bg-primary-500/30'
			: 'bg-surface-100-900 hover:bg-primary-500/10',
		isDropTarget ? 'bg-primary-500/10 ring-2 ring-primary-500' : '',
		isDragging ? 'opacity-60' : ''
	]}
	draggable={dragEnabled && entry.kind === 'file' && !renaming}
	onclick={(e) => onrowClick?.(entry, e)}
	onkeydown={(e) => {
		if (!renaming && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			onrowClick?.(entry, e as unknown as MouseEvent);
		}
	}}
	ondblclick={() => onrowDoubleClick?.(entry)}
	oncontextmenu={(e) => onrowContextMenu?.(entry, e)}
	ondragstart={(e) => ondragStart?.(entry, e)}
	ondragend={() => ondragEnd?.()}
	ondragenter={() => ondragEnter?.(entry)}
	ondragover={(e) => ondragOver?.(entry, e)}
	ondragleave={(e) => ondragLeave?.(entry, e)}
	ondrop={(e) => ondrop?.(entry, e)}
>
	{#if renaming}
		<div data-rename-input-entry-id={entry.id} class="px-2 pt-2 pb-2">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="input"
				value={renameValue}
				autofocus
				oninput={(e) => onupdateRenameValue?.((e.currentTarget as HTMLInputElement).value)}
				onblur={() => onsaveRename?.(entry)}
				onkeydown={(e) => {
					if (e.key === 'Enter') onsaveRename?.(entry);
					else if (e.key === 'Escape') oncancelRename?.();
				}}
				onclick={(e) => e.stopPropagation()}
			/>
		</div>
	{:else}
		<div
			class="flex min-w-0 items-start gap-2 px-2"
			class:py-3={entry.kind === 'folder'}
			class:pt-2={entry.kind !== 'folder'}
			class:pb-2={entry.kind !== 'folder'}
		>
			<AppIcon
				name={entry.kind === 'folder' ? ICONS.folder : getMimeIcon(entry.mimeType)}
				class={[
					'mt-0.5 size-4 shrink-0 text-surface-500',
					showTrashed && entry.kind === 'file' ? 'opacity-50' : ''
				].join(' ')}
			/>
			<span class="w-full truncate text-left text-sm font-semibold" title={folderTitle}>
				{folderTitle}
			</span>
			{#if entry.kind === 'file' && entry.hasDuplicates}
				<span class="mt-0.5 shrink-0" title="Duplicate of another file in this library">
					<AppIcon name={ICONS.duplicate} class="size-4 text-warning-500" />
				</span>
			{/if}
			{#if entry.tags?.length}
				<div class="flex shrink-0 items-center gap-1">
					{#each entry.tags as tag (tag.id)}
						<span
							class="size-2 rounded-full border border-surface-400/50"
							title={tag.name}
							style:background-color={tag.color}
						></span>
					{/each}
				</div>
			{/if}
		</div>

		{#if entry.kind === 'file'}
			<div
				class="flex aspect-video w-full items-center justify-center overflow-hidden bg-surface-200-800"
			>
				{#if entry.mimeType.startsWith('video/')}
					<div class="relative flex h-full w-full items-center justify-center">
						{#if !failedThumbnails.has(entry.id) && entry.thumbnailFileId}
							<AlcovesImage
								{libraryId}
								fileId={entry.thumbnailFileId}
								alt={entry.name}
								variant="card"
								sourceWidth={entry.width}
								sourceHeight={entry.height}
								class="h-full w-full object-cover"
								onerror={() => onthumbnailError?.(entry.id)}
							/>
						{:else if !failedThumbnails.has(entry.id)}
							<img
								src={apiUrl(`/api/libraries/${libraryId}/files/${entry.id}/thumbnail`)}
								alt={entry.name}
								class="h-full w-full object-cover"
								loading="lazy"
								decoding="async"
								draggable="false"
								crossorigin="use-credentials"
								onerror={() => onthumbnailError?.(entry.id)}
							/>
						{:else}
							<AppIcon name={ICONS.movie} class="size-10 text-surface-500" />
						{/if}
						{#if entry.proxyStatus === 'processing'}
							<div class="absolute inset-0 flex items-center justify-center bg-black/40">
								<AppIcon name={ICONS.loading} class="size-5 animate-spin text-white" />
							</div>
						{/if}
						{#if durationLabel}
							<span
								class="absolute right-1 bottom-1 rounded bg-black/80 px-1.5 py-0.5 text-xs leading-none font-medium text-white tabular-nums"
							>
								{durationLabel}
							</span>
						{/if}
					</div>
				{:else if isImageFile(entry)}
					{#if !failedThumbnails.has(entry.id)}
						<AlcovesImage
							{libraryId}
							fileId={entry.id}
							alt={entry.name}
							variant="card"
							sourceWidth={entry.width}
							sourceHeight={entry.height}
							class={isSmallImage(entry) ? 'object-contain' : 'h-full w-full object-cover'}
							onerror={() => onthumbnailError?.(entry.id)}
						/>
					{:else}
						<AppIcon name={ICONS.image} class="size-10 text-surface-500" />
					{/if}
				{:else}
					<AppIcon
						name={getMimeIcon(entry.mimeType)}
						class={['size-10 text-surface-500', showTrashed ? 'opacity-50' : ''].join(' ')}
					/>
				{/if}
			</div>
		{/if}
	{/if}
</div>
