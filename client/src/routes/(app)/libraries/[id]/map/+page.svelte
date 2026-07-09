<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ICONS } from '$lib/utils/icons';
	import { createLibraryMap } from '$lib/state/library-map.svelte';
	import { api } from '$lib/api';
	import type { LibraryFile, MapPoint } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';
	import LibraryMap from '$lib/components/LibraryMap.svelte';

	const libraryId = $derived(page.params.id ?? '');

	const map = createLibraryMap();

	let previewFile = $state<LibraryFile | null>(null);
	let previewOpen = $state(false);

	// Ordered, lightweight LibraryFile records for every geotagged point so the
	// lightbox can page through the whole map. Map points are a thin DTO, so the
	// displayed file is always (re)fetched in full on open and on navigate.
	const previewFiles = $derived<LibraryFile[]>(
		map.points.map((p) => ({
			id: p.id,
			libraryId,
			parentFolderId: null,
			name: p.name,
			kind: 'file',
			mimeType: '',
			size: 0,
			duration: null,
			width: null,
			height: null,
			proxyStatus: null,
			thumbnailFileId: p.thumbnailFileId,
			sourceFileId: null,
			originalCreatedAt: null,
			capturedAt: p.capturedAt,
			gpsLat: p.lat,
			gpsLon: p.lon,
			hash: null,
			trashedAt: null,
			createdAt: p.capturedAt ?? '',
			updatedAt: p.capturedAt ?? '',
			owner: null,
			tags: []
		}))
	);

	// Map points are a thin DTO; fetch the full file before opening the lightbox.
	async function onSelect(point: MapPoint) {
		try {
			const file = await api.files.get(libraryId, point.id);
			previewFile = file;
			previewOpen = true;
		} catch {
			// Ignore — file may have been removed since the map loaded.
		}
	}

	// Lightbox prev/next emits one of the thin previewFiles records — refetch it in
	// full so the preview has real mime/proxy data, mirroring onSelect.
	async function onNavigate(file: LibraryFile) {
		try {
			previewFile = await api.files.get(libraryId, file.id);
		} catch {
			// Ignore — file may have been removed since the map loaded.
		}
	}

	onMount(() => {
		void map.load(libraryId);
	});
</script>

<div class="flex h-full flex-col">
	{#if map.points.length > 0}
		<div class="border-b px-4 py-2 text-xs text-muted-foreground">
			{map.points.length} geotagged {map.points.length === 1 ? 'photo' : 'photos'}
		</div>
	{/if}

	{#if map.truncated}
		<div class="border-b bg-warning/10 px-4 py-2 text-xs text-warning">
			Showing the most recent {map.points.length} geotagged files. Some points are not displayed.
		</div>
	{/if}

	<div class="relative min-h-0 flex-1">
		<!-- Loading -->
		{#if map.loading && map.points.length === 0}
			<div
				class="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground"
			>
				<AppIcon name={ICONS.loading} class="size-5 animate-spin" />
			</div>
			<!-- Error -->
		{:else if map.error}
			<div
				class="absolute inset-0 z-10 flex items-center justify-center px-4 text-center text-sm text-destructive"
			>
				{map.error}
			</div>
			<!-- Empty -->
		{:else if !map.loading && map.points.length === 0}
			<div
				class="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground"
			>
				<AppIcon name={ICONS.location} class="mb-3 size-8 opacity-40" />
				<p>No geotagged photos yet.</p>
				<p class="mt-1 text-xs">
					Photos with GPS metadata appear here once their location is extracted.
				</p>
			</div>
		{/if}

		<!-- Map (client-only component). Only mounted once there are points to
		     plot, so an empty/loading library never fetches map tiles. The map
		     component fills its own h-full/w-full root; wrap it so it overlays the
		     relative container. -->
		{#if map.points.length > 0}
			<div class="absolute inset-0">
				<LibraryMap points={map.points} onselect={onSelect} />
			</div>
		{/if}
	</div>

	{#if previewFile}
		<FilePreview
			bind:open={previewOpen}
			file={previewFile}
			{libraryId}
			files={previewFiles}
			onnavigate={onNavigate}
		/>
	{/if}
</div>
