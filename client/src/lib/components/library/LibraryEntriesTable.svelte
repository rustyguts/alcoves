<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryEntry } from '$lib/types/api';
	import { formatDate, formatFileSize, getMimeIcon } from '$lib/utils/mime-icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { cn } from '$lib/utils';

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

<!--
	The table root stays a bare element (not Table.Root's wrapper) on purpose: that
	wrapper hardcodes `overflow-x-auto`, which per the CSS overflow spec forces
	`overflow-y` to compute to `auto` too — turning it into a second scrolling
	ancestor that breaks the sticky header's containing-block chain back to the
	real (outer) scroll container. Table.Header/Body/Row/Head/Cell still provide
	all the primitive styling/semantics.
-->
<table class="w-full">
	<Table.Header class="sticky top-0 z-30 border-b border-border [&_tr]:border-0">
		<Table.Row class="hover:bg-transparent">
			<Table.Head class="w-12 rounded-tl-xl bg-background/90 px-4 py-3 backdrop-blur-sm"
			></Table.Head>
			<Table.Head
				class="bg-background/90 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm"
			>
				Name
			</Table.Head>
			<Table.Head
				class="bg-background/90 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm"
			>
				Tags
			</Table.Head>
			<Table.Head
				class="hidden bg-background/90 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm sm:table-cell"
			>
				Owner
			</Table.Head>
			<Table.Head
				class="hidden bg-background/90 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm sm:table-cell"
			>
				{showTrashed ? 'Trashed' : 'Modified'}
			</Table.Head>
			<Table.Head
				class="hidden rounded-tr-xl bg-background/90 px-4 py-3 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm sm:table-cell"
			>
				Size
			</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body class="divide-y divide-border/60 select-none">
		{#each entries as entry (`${entry.kind}-${entry.id}`)}
			<Table.Row
				tabindex={0}
				class={cn(
					'cursor-pointer transition-colors',
					'focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-inset',
					isEntrySelected(entry) ? 'bg-primary/20 hover:bg-primary/30' : 'hover:bg-primary/10',
					dropTargetFolderId === entry.id &&
						entry.kind === 'folder' &&
						'bg-primary/5 ring-2 ring-primary/60 ring-inset',
					(entry.kind === 'file'
						? draggedFileIds.includes(entry.id)
						: draggedFolderIds.includes(entry.id)) && 'opacity-60'
				)}
				draggable={dragEnabled && !isRenaming(entry)}
				onclick={(e) => onrowClick?.(entry, e)}
				onkeydown={(e) => {
					if (!isRenaming(entry) && (e.key === 'Enter' || e.key === ' ')) {
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
				<Table.Cell class="px-4 py-3">
					<div class="flex items-center justify-center">
						<AppIcon
							name={entry.kind === 'folder' ? ICONS.folder : getMimeIcon(entry.mimeType)}
							class={cn(
								'size-5 text-muted-foreground',
								showTrashed && entry.kind === 'file' && 'opacity-50'
							)}
						/>
					</div>
				</Table.Cell>
				<Table.Cell class="min-w-0 px-4 py-3">
					{#if isRenaming(entry)}
						<div data-rename-input-entry-id={entry.id}>
							<Input
								class="w-full"
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
									class={cn(
										'block truncate text-left text-sm font-semibold whitespace-nowrap',
										showTrashed && 'opacity-60'
									)}
									title={entry.name}
								>
									{entry.name}
								</span>
							{/if}
							{#if entry.kind === 'file' && entry.hasDuplicates}
								<Badge
									variant="outline"
									class="ml-1 gap-1 border-warning/30 bg-warning/10 text-warning"
									title="Duplicate of another file in this library"
								>
									<AppIcon name={ICONS.duplicate} class="size-3" />
									Duplicate
								</Badge>
							{/if}
						</div>
					{/if}
				</Table.Cell>
				<Table.Cell class="px-4 py-3">
					<div class="flex flex-wrap items-center gap-1.5">
						{#each entry.tags as tag (tag.id)}
							<span
								class="size-2.5 rounded-full border border-border"
								title={tag.name}
								style:background-color={tag.color}
							></span>
						{/each}
					</div>
				</Table.Cell>
				<Table.Cell class="hidden px-4 py-3 text-sm text-muted-foreground sm:table-cell">
					{#if entry.owner}
						<div class="flex items-center">
							<UserAvatar
								displayName={entry.owner.displayName}
								avatarUrl={entry.owner.avatarUrl}
								sizeClass="w-6"
								textSizeClass="text-[10px]"
								bgClass="bg-primary/10 text-primary"
								tooltip
								tooltipPosition="right"
							/>
						</div>
					{:else}
						<span>-</span>
					{/if}
				</Table.Cell>
				<Table.Cell
					class="hidden px-4 py-3 text-sm whitespace-nowrap text-muted-foreground sm:table-cell"
				>
					{showTrashed && entry.trashedAt
						? formatDate(entry.trashedAt)
						: formatDate(entry.updatedAt)}
				</Table.Cell>
				<Table.Cell
					class="hidden px-4 py-3 text-right text-sm whitespace-nowrap text-muted-foreground sm:table-cell"
				>
					{entry.kind === 'folder' ? '-' : formatFileSize(entry.size)}
				</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</table>
