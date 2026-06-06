<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { ICONS } from '$lib/utils/icons';
	import { createLibraryTimeline, type TimelineGroup } from '$lib/state/library-timeline.svelte';
	import type { LibraryFile } from '$lib/types/api';
	import type { GalleryGroup, GalleryItem } from '$lib/utils/gallery-types';
	import { formatDuration } from '$lib/utils/format-duration';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';
	import JustifiedGallery from '$lib/components/JustifiedGallery.svelte';
	import TimelineScrubber from '$lib/components/TimelineScrubber.svelte';

	const libraryId = $derived(page.params.id ?? '');

	const timeline = createLibraryTimeline(() => page.params.id ?? '');
	// Timeline is photos & videos only — there is no file/all toggle here.
	timeline.setType('media');

	let previewFile = $state<LibraryFile | null>(null);
	let previewOpen = $state(false);

	function isImage(f: LibraryFile): boolean {
		return f.mimeType.startsWith('image/');
	}
	function isVideo(f: LibraryFile): boolean {
		return f.mimeType.startsWith('video/');
	}
	// The id whose rendered image we show as the tile thumbnail: the file itself for
	// images, the generated poster for videos, null for everything else.
	function thumbId(f: LibraryFile): string | null {
		if (isImage(f)) return f.id;
		if (isVideo(f)) return f.thumbnailFileId ?? null;
		return null;
	}
	// Native aspect ratio of the media; files without extracted dimensions fall back
	// to square.
	function aspectOf(f: LibraryFile): number {
		if (f.width && f.height && f.width > 0 && f.height > 0) return f.width / f.height;
		return 1;
	}

	function openPreview(file: LibraryFile) {
		previewFile = file;
		previewOpen = true;
	}

	const thisYear = new Date().getUTCFullYear();

	// Map the store's day groups into gallery groups. The gallery runs in
	// `continuous` mode: each day is its own section with a heading band, and the
	// day's rows are stretched to fill the container's full width.
	const galleryGroups = $derived<GalleryGroup<LibraryFile>[]>(
		timeline.groups.map((g: TimelineGroup) => {
			const d = dayDate(g.key);
			return {
				key: g.key,
				sectionLabel: null,
				heading: formatDay(d),
				count: g.files.length,
				items: g.files.map(
					(f): GalleryItem<LibraryFile> => ({
						id: f.id,
						libraryId,
						thumbnailFileId: thumbId(f),
						aspect: aspectOf(f),
						mime: f.mimeType,
						name: f.name,
						isVideo: isVideo(f),
						durationLabel: isVideo(f) ? formatDuration(f.duration) : null,
						sourceWidth: f.width,
						sourceHeight: f.height,
						raw: f
					})
				)
			};
		})
	);

	// `Y-M-D` (UTC) key → Date. Month is the 0-based value emitted by the store.
	function dayDate(key: string): Date {
		const [y, m, day] = key.split('-').map(Number);
		return new Date(Date.UTC(y ?? 1970, m ?? 0, day ?? 1));
	}

	function formatDay(d: Date): string {
		if (Number.isNaN(d.getTime())) return 'Unknown date';
		const sameYear = d.getUTCFullYear() === thisYear;
		return d.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			...(sameYear ? {} : { year: 'numeric' }),
			timeZone: 'UTC'
		});
	}

	let scrollEl = $state<HTMLElement | null>(null);

	// Current scroll position as a 0..1 fraction (0 = top = newest), fed to the
	// scrubber so its handle tracks normal scrolling. rAF-throttled to one update
	// per frame.
	let progress = $state(0);
	let scrollRaf = 0;

	function maxScroll(el: HTMLElement): number {
		return Math.max(0, el.scrollHeight - el.clientHeight);
	}

	function onScroll() {
		if (scrollRaf) return;
		scrollRaf = requestAnimationFrame(() => {
			scrollRaf = 0;
			const el = scrollEl;
			if (!el) return;
			const max = maxScroll(el);
			progress = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
		});
	}

	// Scrub from the rail: scroll proportionally to the dragged fraction. The grid's
	// scroll height grows as more pages load, so this lands close to the target
	// period and infinite-scroll fills in the rest.
	function onScrub(fraction: number) {
		const el = scrollEl;
		if (!el) return;
		el.scrollTop = Math.min(1, Math.max(0, fraction)) * maxScroll(el);
	}

	// Infinite scroll: observe a sentinel near the bottom and pull the next page.
	let sentinel = $state<HTMLElement | null>(null);
	let observer: IntersectionObserver | null = null;

	onMount(async () => {
		await timeline.loadFirst();
		if (sentinel) {
			observer = new IntersectionObserver(
				(entries) => {
					if (entries.some((e) => e.isIntersecting)) timeline.loadMore();
				},
				{ root: scrollEl, rootMargin: '800px' }
			);
			observer.observe(sentinel);
		}
	});

	onDestroy(() => {
		observer?.disconnect();
		if (scrollRaf) cancelAnimationFrame(scrollRaf);
	});
</script>

<div class="flex h-full min-h-0">
	<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto" onscroll={onScroll}>
		{#if timeline.loading && timeline.entries.length === 0}
			<!-- Loading -->
			<div class="text-dimmed px-4 py-12 text-center text-sm">
				<AppIcon name={ICONS.loading} class="inline-block size-5 animate-spin" />
				<p class="mt-2">Loading timeline…</p>
			</div>
		{:else if timeline.error}
			<!-- Error -->
			<div class="px-4 py-12 text-center text-sm text-error-500">
				{timeline.error}
			</div>
		{:else if timeline.entries.length === 0}
			<!-- Empty -->
			<div class="text-dimmed px-4 py-16 text-center text-sm">
				<AppIcon name={ICONS.timeline} class="mx-auto mb-3 size-8 opacity-40" />
				<p>Nothing to show yet.</p>
				<p class="mt-1 text-xs">
					Capture dates are extracted in the background — check back shortly after uploading.
				</p>
			</div>
		{:else}
			<!-- Justified gallery -->
			<div class="px-2 pt-2 pb-6 sm:px-3">
				<JustifiedGallery continuous groups={galleryGroups} onselect={openPreview} />

				<!-- Infinite-scroll sentinel + load-more fallback -->
				<div bind:this={sentinel} class="h-px"></div>
				{#if timeline.loadingMore}
					<div class="text-dimmed py-4 text-center text-sm">
						<AppIcon name={ICONS.loading} class="inline-block size-4 animate-spin" />
					</div>
				{:else if timeline.nextCursor}
					<div class="py-4 text-center">
						<button
							type="button"
							class="text-sm text-primary-500 hover:underline"
							onclick={() => timeline.loadMore()}
						>
							Load more
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if timeline.buckets.length > 1}
		<TimelineScrubber buckets={timeline.buckets} {progress} onscrub={onScrub} />
	{/if}

	{#if previewFile}
		<FilePreview
			bind:open={previewOpen}
			file={previewFile}
			{libraryId}
			files={timeline.entries}
			onnavigate={(f) => (previewFile = f)}
		/>
	{/if}
</div>
