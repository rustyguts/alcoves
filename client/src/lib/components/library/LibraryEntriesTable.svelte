<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryEntry } from '$lib/types/api';
	import { formatDate, formatFileSize, getMimeIcon } from '$lib/utils/mime-icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';

	interface Props {
		entries: LibraryEntry[];
		showTrashed: boolean;
		dragEnabled: boolean;
		draggedFileIds: string[];
		draggedFolderIds: string[];
		dropTargetFolderId: string | null;
		renameValue: string;
		isEntrySelected: (entry: LibraryEntry) => boolean;
		isRenaming: (entry: LibraryEntry) => boolean;
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
	}

	let {
		entries,
		showTrashed,
		dragEnabled,
		draggedFileIds,
		draggedFolderIds,
		dropTargetFolderId,
		renameValue,
		isEntrySelected,
		isRenaming,
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
		onupdateRenameValue
	}: Props = $props();
</script>

<table class="w-full">
	<thead class="sticky top-0 z-30 border-b border-surface-200-800">
		<tr>
			<th class="w-12 rounded-tl-xl bg-surface-50-950/90 px-4 py-3 backdrop-blur-sm"></th>
			<th
				class="bg-surface-50-950/90 px-4 py-3 text-left text-xs font-semibold tracking-wide text-surface-700-300 uppercase backdrop-blur-sm"
			>
				Name
			</th>
			<th
				class="bg-surface-50-950/90 px-4 py-3 text-left text-xs font-semibold tracking-wide text-surface-700-300 uppercase backdrop-blur-sm"
			>
				Tags
			</th>
			<th
				class="hidden bg-surface-50-950/90 px-4 py-3 text-left text-xs font-semibold tracking-wide text-surface-700-300 uppercase backdrop-blur-sm sm:table-cell"
			>
				Owner
			</th>
			<th
				class="hidden bg-surface-50-950/90 px-4 py-3 text-left text-xs font-semibold tracking-wide text-surface-700-300 uppercase backdrop-blur-sm sm:table-cell"
			>
				{showTrashed ? 'Trashed' : 'Modified'}
			</th>
			<th
				class="hidden rounded-tr-xl bg-surface-50-950/90 px-4 py-3 text-right text-xs font-semibold tracking-wide text-surface-700-300 uppercase backdrop-blur-sm sm:table-cell"
			>
				Size
			</th>
		</tr>
	</thead>
	<tbody class="divide-y divide-surface-200-800/60 select-none">
		{#each entries as entry (`${entry.kind}-${entry.id}`)}
			<tr
				class={[
					'cursor-pointer transition-colors',
					isEntrySelected(entry)
						? 'bg-primary-500/20 hover:bg-primary-500/30'
						: 'hover:bg-primary-500/10',
					dropTargetFolderId === entry.id && entry.kind === 'folder'
						? 'bg-primary-500/5 ring-2 ring-primary-500/60 ring-inset'
						: '',
					(
						entry.kind === 'file'
							? draggedFileIds.includes(entry.id)
							: draggedFolderIds.includes(entry.id)
					)
						? 'opacity-60'
						: ''
				]}
				draggable={dragEnabled && !isRenaming(entry)}
				onclick={(e) => onrowClick?.(entry, e)}
				ondblclick={() => onrowDoubleClick?.(entry)}
				oncontextmenu={(e) => onrowContextMenu?.(entry, e)}
				ondragstart={(e) => ondragStart?.(entry, e)}
				ondragend={() => ondragEnd?.()}
				ondragenter={() => ondragEnter?.(entry)}
				ondragover={(e) => ondragOver?.(entry, e)}
				ondragleave={(e) => ondragLeave?.(entry, e)}
				ondrop={(e) => ondrop?.(entry, e)}
			>
				<td class="px-4 py-3">
					<div class="flex items-center justify-center">
						<AppIcon
							name={entry.kind === 'folder' ? ICONS.folder : getMimeIcon(entry.mimeType)}
							class={[
								'size-5 text-surface-500',
								showTrashed && entry.kind === 'file' ? 'opacity-50' : ''
							].join(' ')}
						/>
					</div>
				</td>
				<td class="min-w-0 px-4 py-3">
					{#if isRenaming(entry)}
						<div data-rename-input-entry-id={entry.id}>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="input w-full"
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
						<div class="flex min-w-0 items-center gap-1">
							{#if entry.kind === 'folder'}
								<span
									class="block truncate text-left text-sm font-semibold whitespace-nowrap"
									title={showTrashed
										? `${entry.name} (${entry.trashFileCount ?? 0} files)`
										: entry.name}
								>
									{showTrashed ? `${entry.name} (${entry.trashFileCount ?? 0} files)` : entry.name}
								</span>
							{:else}
								<span
									class={[
										'block truncate text-left text-sm font-semibold whitespace-nowrap',
										showTrashed ? 'opacity-60' : ''
									]}
									title={entry.name}
								>
									{entry.name}
								</span>
							{/if}
							{#if entry.kind === 'file' && entry.hasDuplicates}
								<span
									class="ml-1 badge gap-1 preset-tonal-warning"
									title="Duplicate of another file in this library"
								>
									<AppIcon name={ICONS.duplicate} class="size-3" />
									Duplicate
								</span>
							{/if}
						</div>
					{/if}
				</td>
				<td class="px-4 py-3">
					<div class="flex flex-wrap items-center gap-1.5">
						{#each entry.tags as tag (tag.id)}
							<span
								class="size-2.5 rounded-full border border-surface-400/50"
								title={tag.name}
								style:background-color={tag.color}
							></span>
						{/each}
					</div>
				</td>
				<td class="hidden px-4 py-3 text-sm text-surface-700-300 sm:table-cell">
					{#if entry.owner}
						<div class="flex items-center">
							<UserAvatar
								displayName={entry.owner.displayName}
								avatarUrl={entry.owner.avatarUrl}
								sizeClass="w-6"
								textSizeClass="text-[10px]"
								bgClass="preset-tonal-primary"
								tooltip
								tooltipPosition="right"
							/>
						</div>
					{:else}
						<span>-</span>
					{/if}
				</td>
				<td class="hidden px-4 py-3 text-sm whitespace-nowrap text-surface-700-300 sm:table-cell">
					{showTrashed && entry.trashedAt
						? formatDate(entry.trashedAt)
						: formatDate(entry.updatedAt)}
				</td>
				<td
					class="hidden px-4 py-3 text-right text-sm whitespace-nowrap text-surface-700-300 sm:table-cell"
				>
					{entry.kind === 'folder' ? '-' : formatFileSize(entry.size)}
				</td>
			</tr>
		{/each}
	</tbody>
</table>
