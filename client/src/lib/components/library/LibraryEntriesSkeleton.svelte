<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	interface Props {
		entryViewMode: 'file' | 'card';
		showTrashed: boolean;
	}

	let { entryViewMode, showTrashed }: Props = $props();

	const rows = [1, 2, 3, 4, 5, 6, 7, 8];
</script>

{#if entryViewMode === 'file'}
	<table class="w-full">
		<thead class="sticky top-0 z-30 shadow-[0_1px_0_0] shadow-border">
			<tr>
				<th class="w-12 rounded-tl-xl bg-background/90 px-4 py-3 backdrop-blur-sm"></th>
				<th
					class="bg-background/90 px-4 py-3 text-left text-xs font-medium text-muted-foreground backdrop-blur-sm"
				>
					Name
				</th>
				<th
					class="bg-background/90 px-4 py-3 text-left text-xs font-medium text-muted-foreground backdrop-blur-sm"
				>
					Tags
				</th>
				<th
					class="hidden bg-background/90 px-4 py-3 text-left text-xs font-medium text-muted-foreground backdrop-blur-sm sm:table-cell"
				>
					Owner
				</th>
				<th
					class="hidden bg-background/90 px-4 py-3 text-left text-xs font-medium text-muted-foreground backdrop-blur-sm sm:table-cell"
				>
					{showTrashed ? 'Trashed' : 'Modified'}
				</th>
				<th
					class="hidden rounded-tr-xl bg-background/90 px-4 py-3 text-right text-xs font-medium text-muted-foreground backdrop-blur-sm sm:table-cell"
				>
					Size
				</th>
			</tr>
		</thead>
		<tbody class="select-none">
			{#each rows as i (i)}
				<tr>
					<td class="px-4 py-3">
						<Skeleton class="h-5 w-5" />
					</td>
					<td class="px-4 py-3">
						<Skeleton class="h-4" style="width: {40 + ((i * 17) % 40)}%" />
					</td>
					<td class="px-4 py-3">
						<Skeleton class="h-3 w-8 rounded-full" />
					</td>
					<td class="hidden px-4 py-3 sm:table-cell">
						<Skeleton class="h-6 w-6 rounded-full" />
					</td>
					<td class="hidden px-4 py-3 sm:table-cell">
						<Skeleton class="h-4 w-20" />
					</td>
					<td class="hidden px-4 py-3 sm:table-cell">
						<Skeleton class="ml-auto h-4 w-14" />
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<div class="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each rows as i (i)}
			<div class="rounded-xl bg-muted/50 p-3">
				<Skeleton class="mb-3 h-40 w-full rounded-lg" />
				<Skeleton class="mb-2 h-4" style="width: {50 + ((i * 13) % 40)}%" />
				<Skeleton class="h-3 w-16" />
			</div>
		{/each}
	</div>
{/if}
