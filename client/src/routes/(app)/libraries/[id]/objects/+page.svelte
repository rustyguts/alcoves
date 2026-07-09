<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import { canManageLibrary } from '$lib/utils/permissions';
	import { portal } from '$lib/actions/portal';
	import { toast } from '$lib/state/toast';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ObjectLabel } from '$lib/types/api';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const libraryId = $derived(page.params.id ?? '');
	const canManage = $derived(canManageLibrary(data.library, data.user));

	let labels = $state<ObjectLabel[]>([]);
	let loading = $state(true);
	let loadError = $state(false);
	let reprocessing = $state(false);

	const totalDetections = $derived(labels.reduce((sum, l) => sum + l.fileCount, 0));

	async function load() {
		loading = true;
		loadError = false;
		try {
			const resp = await api.objects.labels(libraryId);
			labels = resp.labels ?? [];
		} catch {
			labels = [];
			loadError = true;
		} finally {
			loading = false;
		}
	}

	async function reprocess() {
		if (reprocessing) return;
		reprocessing = true;
		try {
			const result = await api.objects.reprocess(libraryId);
			toast.add({
				title: 'Reprocessing queued',
				description: `${result.queuedCount} image${result.queuedCount === 1 ? '' : 's'} queued for fresh object detection.`
			});
			await load();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Failed to queue object detection reprocessing';
			toast.error(message);
		} finally {
			reprocessing = false;
		}
	}

	onMount(load);
</script>

{#if canManage}
	<!-- Injected into the library header's action row (see +layout.svelte). -->
	<div use:portal={'#library-header-actions'}>
		<Button variant="ghost" size="sm" disabled={reprocessing} onclick={reprocess}>
			<AppIcon
				name={ICONS.objectDetection}
				class={['size-4', reprocessing && 'animate-spin'].filter(Boolean).join(' ')}
			/>
			<span>{reprocessing ? 'Queuing…' : 'Reprocess'}</span>
		</Button>
	</div>
{/if}

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-0.5">
	{#if loading}
		<div class="flex items-center justify-center py-12">
			<AppIcon name={ICONS.loading} class="size-6 animate-spin text-muted-foreground" />
		</div>
	{:else if loadError}
		<EmptyState
			icon={ICONS.warning}
			title="Couldn't load object labels"
			description="Something went wrong fetching detections. Try again."
			tone="error"
		>
			{#snippet actions()}
				<Button variant="outline" onclick={load}>
					<AppIcon name={ICONS.reload} class="size-4" />
					Retry
				</Button>
			{/snippet}
		</EmptyState>
	{:else if labels.length === 0}
		<EmptyState
			icon={ICONS.objectDetection}
			title="No objects detected yet"
			description="Upload images to start detecting objects across this library."
		/>
	{:else}
		<div class="flex items-center gap-2 text-sm">
			<Badge variant="secondary">{labels.length} labels</Badge>
			<Badge variant="secondary">{totalDetections} total detections</Badge>
		</div>

		<div class="overflow-hidden rounded-lg border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Label</Table.Head>
						<Table.Head class="text-right">Photos</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each labels as item (item.label)}
						<Table.Row>
							<Table.Cell>
								<Badge variant="outline">{item.label}</Badge>
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{item.fileCount}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>
