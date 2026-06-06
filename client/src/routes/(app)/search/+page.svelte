<script lang="ts">
	import { page } from '$app/state';
	import { ICONS } from '$lib/utils/icons';
	import { api } from '$lib/api';
	import type { GalleryGroup } from '$lib/utils/gallery-types';
	import type { GlobalSearchResponse, GlobalSearchResult, LibraryFile } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import JustifiedGallery from '$lib/components/JustifiedGallery.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';

	const MIN_QUERY_LENGTH = 2;
	const SEARCH_LIMIT = 80;

	// `q` comes from the global search bar in the dashboard header, which pushes it
	// into the URL. This page owns no input of its own — it only reacts to the URL.
	const activeQuery = $derived((page.url.searchParams.get('q') ?? '').trim());

	function createEmptySearchResponse(query = ''): GlobalSearchResponse {
		return { query, totalCount: 0, results: [] };
	}

	let searchData = $state<GlobalSearchResponse>(createEmptySearchResponse());
	let status = $state<'idle' | 'pending' | 'success' | 'error'>('idle');

	// Re-run the search whenever the active query changes. A query shorter than the
	// minimum just clears the results (no request); a longer one fetches and races
	// are guarded by comparing the captured query against the latest one.
	$effect(() => {
		const query = activeQuery;
		if (query.length < MIN_QUERY_LENGTH) {
			searchData = createEmptySearchResponse(query);
			status = 'idle';
			return;
		}

		let cancelled = false;
		status = 'pending';
		api.search
			.query({ q: query, limit: String(SEARCH_LIMIT) })
			.then((data) => {
				if (cancelled) return;
				searchData = data;
				status = 'success';
			})
			.catch(() => {
				if (cancelled) return;
				searchData = createEmptySearchResponse(query);
				status = 'error';
			});

		return () => {
			cancelled = true;
		};
	});

	const results = $derived(searchData.results ?? []);

	function isVideoResult(result: GlobalSearchResult): boolean {
		return (result.mimeType ?? '').startsWith('video/');
	}

	// Thumbnail source: the file itself for images, the generated poster for videos,
	// null (→ icon tile) for folders and non-media files.
	function getThumbnailFileId(result: GlobalSearchResult): string | null {
		if (result.kind !== 'file') return null;
		const mime = result.mimeType ?? '';
		if (mime.startsWith('image/')) return result.id;
		if (mime.startsWith('video/') && result.thumbnailFileId) return result.thumbnailFileId;
		return null;
	}

	function aspectOf(result: GlobalSearchResult): number {
		if (result.width && result.height && result.width > 0 && result.height > 0) {
			return result.width / result.height;
		}
		// Folders read as wide tiles; everything else falls back to square.
		return result.kind === 'folder' ? 1.6 : 1;
	}

	// Group results by library, mapped into the shared gallery shape. The library
	// name is the sticky heading; matched object labels become a tile badge.
	const galleryGroups = $derived.by<GalleryGroup<GlobalSearchResult>[]>(() => {
		const groups: GalleryGroup<GlobalSearchResult>[] = [];
		const byLibraryId = new Map<string, GalleryGroup<GlobalSearchResult>>();

		for (const result of results) {
			let group = byLibraryId.get(result.libraryId);
			if (!group) {
				group = { key: result.libraryId, heading: result.libraryName, count: 0, items: [] };
				byLibraryId.set(result.libraryId, group);
				groups.push(group);
			}
			group.items.push({
				id: `${result.kind}-${result.id}`,
				libraryId: result.libraryId,
				thumbnailFileId: getThumbnailFileId(result),
				aspect: aspectOf(result),
				mime:
					result.kind === 'folder'
						? 'inode/directory'
						: (result.mimeType ?? 'application/octet-stream'),
				name: result.name,
				isVideo: isVideoResult(result),
				sourceWidth: result.width,
				sourceHeight: result.height,
				badge: result.matchedLabels?.length ? result.matchedLabels.join(', ') : null,
				raw: result
			});
			group.count = group.items.length;
		}

		return groups;
	});

	let previewFile = $state<LibraryFile | null>(null);
	let previewOpen = $state(false);
	const previewFiles = $derived<LibraryFile[]>(previewFile ? [previewFile] : []);

	async function openPreview(result: GlobalSearchResult) {
		if (result.kind !== 'file') return;
		try {
			const file = await api.files.get(result.libraryId, result.id);
			previewFile = file;
			previewOpen = true;
		} catch {
			// silent
		}
	}
</script>

<div class="min-h-0 w-full flex-1 space-y-6 overflow-y-auto px-0.5">
	{#if results.length}
		<div class="flex flex-wrap items-center gap-2 text-xs text-surface-500">
			<span class="rounded bg-surface-200-800 px-2 py-0.5 font-medium">
				{searchData.totalCount ?? 0} total matches
			</span>
			<span class="rounded bg-surface-200-800 px-2 py-0.5 font-medium">
				{results.length} shown
			</span>
			{#if (searchData.totalCount ?? 0) > results.length}
				<span>Showing the top {results.length} most relevant results.</span>
			{/if}
		</div>
	{/if}

	{#if activeQuery.length < MIN_QUERY_LENGTH}
		<div
			class="flex items-center gap-3 rounded-lg bg-primary-500/10 px-4 py-3 text-sm text-primary-600"
		>
			<AppIcon name={ICONS.search} class="size-5 shrink-0" />
			<span>Enter at least {MIN_QUERY_LENGTH} characters to start searching.</span>
		</div>
	{:else if status === 'pending'}
		<div class="flex items-center justify-center py-12">
			<AppIcon name={ICONS.loading} class="size-6 animate-spin text-surface-500" />
		</div>
	{:else if status === 'error'}
		<div
			class="flex items-center gap-3 rounded-lg bg-error-500/10 px-4 py-3 text-sm text-error-600"
		>
			<AppIcon name={ICONS.warning} class="size-5 shrink-0" />
			<div>
				<p class="font-medium">Search failed</p>
				<p>Try again in a moment.</p>
			</div>
		</div>
	{:else if !results.length}
		<div
			class="flex items-center gap-3 rounded-lg bg-surface-200-800 px-4 py-3 text-sm text-surface-500"
		>
			<AppIcon name={ICONS.folder} class="size-5 shrink-0" />
			<span>No results found for “{activeQuery}”.</span>
		</div>
	{:else}
		<div>
			<JustifiedGallery groups={galleryGroups} onselect={openPreview} />
		</div>
	{/if}

	{#if previewFile}
		<FilePreview
			bind:open={previewOpen}
			file={previewFile}
			libraryId={previewFile.libraryId}
			files={previewFiles}
			onnavigate={(f) => (previewFile = f)}
		/>
	{/if}
</div>
