<script lang="ts">
	interface Props {
		entryViewMode: 'file' | 'card';
		showTrashed: boolean;
	}

	let { entryViewMode, showTrashed }: Props = $props();

	const rows = [1, 2, 3, 4, 5, 6, 7, 8];
</script>

{#if entryViewMode === 'file'}
	<table class="w-full">
		<thead class="sticky top-0 z-30 shadow-[0_1px_0_0] shadow-surface-300-700/70">
			<tr>
				<th class="w-12 rounded-tl-xl bg-surface-50-950/90 px-4 py-3 backdrop-blur-sm"></th>
				<th
					class="bg-surface-50-950/90 px-4 py-3 text-left text-xs font-medium text-surface-600-400 backdrop-blur-sm"
				>
					Name
				</th>
				<th
					class="bg-surface-50-950/90 px-4 py-3 text-left text-xs font-medium text-surface-600-400 backdrop-blur-sm"
				>
					Tags
				</th>
				<th
					class="hidden bg-surface-50-950/90 px-4 py-3 text-left text-xs font-medium text-surface-600-400 backdrop-blur-sm sm:table-cell"
				>
					Owner
				</th>
				<th
					class="hidden bg-surface-50-950/90 px-4 py-3 text-left text-xs font-medium text-surface-600-400 backdrop-blur-sm sm:table-cell"
				>
					{showTrashed ? 'Trashed' : 'Modified'}
				</th>
				<th
					class="hidden rounded-tr-xl bg-surface-50-950/90 px-4 py-3 text-right text-xs font-medium text-surface-600-400 backdrop-blur-sm sm:table-cell"
				>
					Size
				</th>
			</tr>
		</thead>
		<tbody class="select-none">
			{#each rows as i (i)}
				<tr>
					<td class="px-4 py-3">
						<div class="h-5 placeholder w-5 animate-pulse rounded"></div>
					</td>
					<td class="px-4 py-3">
						<div
							class="h-4 placeholder animate-pulse rounded"
							style="width: {40 + ((i * 17) % 40)}%"
						></div>
					</td>
					<td class="px-4 py-3">
						<div class="h-3 placeholder w-8 animate-pulse rounded-full"></div>
					</td>
					<td class="hidden px-4 py-3 sm:table-cell">
						<div class="h-6 placeholder w-6 animate-pulse rounded-full"></div>
					</td>
					<td class="hidden px-4 py-3 sm:table-cell">
						<div class="h-4 placeholder w-20 animate-pulse rounded"></div>
					</td>
					<td class="hidden px-4 py-3 sm:table-cell">
						<div class="ml-auto h-4 placeholder w-14 animate-pulse rounded"></div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<div class="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each rows as i (i)}
			<div class="rounded-xl bg-surface-100-900/50 p-3">
				<div class="mb-3 h-40 placeholder w-full animate-pulse rounded-lg"></div>
				<div
					class="mb-2 h-4 placeholder animate-pulse rounded"
					style="width: {50 + ((i * 13) % 40)}%"
				></div>
				<div class="h-3 placeholder w-16 animate-pulse rounded"></div>
			</div>
		{/each}
	</div>
{/if}
