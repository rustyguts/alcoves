<script lang="ts">
	import type { LibraryEntry, LibraryFile, LibraryFolder } from '$lib/types/api';
	import LibraryEntryCard from '$lib/components/library/LibraryEntryCard.svelte';

	interface Props {
		entries: LibraryEntry[];
		libraryId: string;
		showTrashed: boolean;
		dragEnabled: boolean;
		draggedFileIds: string[];
		draggedFolderIds: string[];
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
		entries,
		libraryId,
		showTrashed,
		dragEnabled,
		draggedFileIds,
		draggedFolderIds,
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

	// Grid mode separates folders from loose files: folders pinned to the top,
	// files below in their own section. Order within each group is preserved.
	const folderEntries = $derived(
		entries.filter((entry): entry is LibraryFolder => entry.kind === 'folder')
	);
	const fileEntries = $derived(
		entries.filter((entry): entry is LibraryFile => entry.kind === 'file')
	);
</script>

<!--
	auto-fill packs as many >=220px columns as fit, then the 1fr max lets
	them grow equally to consume the leftover track so the grid is always
	full-width with no dead space at the end of a row. Cards stay >=220px
	(never cramped) and the 16:9 thumbnail keeps the consistent card shape.
-->
<div class="flex flex-col gap-4 p-3">
	{#if folderEntries.length > 0}
		<section>
			<div class="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
				{#each folderEntries as entry (`folder-${entry.id}`)}
					<LibraryEntryCard
						{entry}
						{libraryId}
						{showTrashed}
						{dragEnabled}
						{draggedFileIds}
						{draggedFolderIds}
						{dropTargetFolderId}
						{renameValue}
						{isEntrySelected}
						{isRenaming}
						{failedThumbnails}
						{isImageFile}
						{isSmallImage}
						onrowClick={(e, ev) => onrowClick?.(e, ev)}
						onrowDoubleClick={(e) => onrowDoubleClick?.(e)}
						onrowContextMenu={(e, ev) => onrowContextMenu?.(e, ev)}
						ondragStart={(e, ev) => ondragStart?.(e, ev)}
						ondragEnd={() => ondragEnd?.()}
						ondragEnter={(e) => ondragEnter?.(e)}
						ondragOver={(e, ev) => ondragOver?.(e, ev)}
						ondragLeave={(e, ev) => ondragLeave?.(e, ev)}
						ondrop={(e, ev) => ondrop?.(e, ev)}
						onsaveRename={(e) => onsaveRename?.(e)}
						oncancelRename={() => oncancelRename?.()}
						onupdateRenameValue={(v) => onupdateRenameValue?.(v)}
						onthumbnailError={(id) => onthumbnailError?.(id)}
					/>
				{/each}
			</div>
		</section>
	{/if}

	{#if fileEntries.length > 0}
		<section>
			<div class="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
				{#each fileEntries as entry (`file-${entry.id}`)}
					<LibraryEntryCard
						{entry}
						{libraryId}
						{showTrashed}
						{dragEnabled}
						{draggedFileIds}
						{draggedFolderIds}
						{dropTargetFolderId}
						{renameValue}
						{isEntrySelected}
						{isRenaming}
						{failedThumbnails}
						{isImageFile}
						{isSmallImage}
						onrowClick={(e, ev) => onrowClick?.(e, ev)}
						onrowDoubleClick={(e) => onrowDoubleClick?.(e)}
						onrowContextMenu={(e, ev) => onrowContextMenu?.(e, ev)}
						ondragStart={(e, ev) => ondragStart?.(e, ev)}
						ondragEnd={() => ondragEnd?.()}
						ondragEnter={(e) => ondragEnter?.(e)}
						ondragOver={(e, ev) => ondragOver?.(e, ev)}
						ondragLeave={(e, ev) => ondragLeave?.(e, ev)}
						ondrop={(e, ev) => ondrop?.(e, ev)}
						onsaveRename={(e) => onsaveRename?.(e)}
						oncancelRename={() => oncancelRename?.()}
						onupdateRenameValue={(v) => onupdateRenameValue?.(v)}
						onthumbnailError={(id) => onthumbnailError?.(id)}
					/>
				{/each}
			</div>
		</section>
	{/if}
</div>
