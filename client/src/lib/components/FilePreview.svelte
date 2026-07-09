<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { ICONS } from '$lib/utils/icons';
	import { getMimeIcon } from '$lib/utils/mime-icons';
	import { proxyQueryString, resolveVariant } from '$lib/shared/image-variants';
	import { api, apiUrl } from '$lib/api';
	import { makeApiFetch } from '$lib/api/fetch';
	import type { LibraryFile, PlaybackSource } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		file: LibraryFile;
		libraryId: string;
		files: LibraryFile[];
		/** Two-way: controls overlay visibility. */
		open?: boolean;
		/** Fired when navigating to an adjacent file (prev/next). */
		onnavigate?: (file: LibraryFile) => void;
	}

	let { file, libraryId, files, open = $bindable(false), onnavigate }: Props = $props();

	// Browser-bound apiFetch for the text-preview fetch.
	const apiFetch = makeApiFetch((input, init) => fetch(input, init));

	const fileUrl = $derived(apiUrl(`/api/libraries/${libraryId}/files/${file.id}?inline=true`));

	let playbackSources = $state<PlaybackSource[]>([]);
	let selectedPlaybackSourceId = $state<string | null>(null);
	let generatingProxy = $state(false);

	// Initial values are seeded from the file; a $effect below re-seeds them when
	// the file changes, so capturing only the initial value here is intentional.
	// svelte-ignore state_referenced_locally
	let proxyStatus = $state<string | null>(file.proxyStatus ?? null);
	// svelte-ignore state_referenced_locally
	let proxyProgress = $state<number | null>(file.proxyProgress ?? null);
	// svelte-ignore state_referenced_locally
	let proxyEtaSeconds = $state<number | null>(file.proxyEtaSeconds ?? null);

	const previewType = $derived.by(() => {
		const mime = file.mimeType;
		if (mime.startsWith('video/')) return 'video';
		if (mime.startsWith('audio/')) return 'audio';
		if (mime.startsWith('image/')) return 'image';
		if (mime === 'application/pdf') return 'pdf';
		if (mime.startsWith('text/')) return 'text';
		return 'unsupported';
	});

	const videoProxyProcessing = $derived(
		previewType === 'video' && ['queued', 'processing'].includes(proxyStatus ?? '')
	);

	const videoProxyProgressPercent = $derived.by(() => {
		const raw = proxyProgress;
		if (raw === null || Number.isNaN(raw)) return 0;
		return Math.min(100, Math.max(0, Math.round(raw)));
	});

	const videoProxyEtaLabel = $derived.by(() => {
		const eta = proxyEtaSeconds;
		if (eta === null || eta <= 0) return null;

		const hours = Math.floor(eta / 3600);
		const minutes = Math.floor((eta % 3600) / 60);
		const seconds = eta % 60;

		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${seconds}s`;
		return `${seconds}s`;
	});

	const selectedPlaybackSource = $derived.by(() => {
		if (!selectedPlaybackSourceId) return null;
		return playbackSources.find((source) => source.id === selectedPlaybackSourceId) ?? null;
	});

	const videoSrc = $derived.by(() => {
		if (file.mimeType.startsWith('video/')) {
			const source = selectedPlaybackSource;
			if (source) return source.streamUrl;
		}
		return fileUrl;
	});

	const videoType = $derived(selectedPlaybackSource?.mimeType ?? file.mimeType);

	let loadedImageWidth = $state<number | null>(null);
	let loadedImageHeight = $state<number | null>(null);

	const imageWidth = $derived(file.width ?? loadedImageWidth);
	const imageHeight = $derived(file.height ?? loadedImageHeight);

	// Keep low-resolution images near their natural display size in the preview.
	const shouldConstrainImageSize = $derived.by(() => {
		const w = imageWidth;
		const h = imageHeight;
		if (!w || !h) return false;

		const megapixels = (w * h) / 1_000_000;
		const longestEdge = Math.max(w, h);

		return megapixels < 1 || longestEdge < 1280;
	});

	const imageSizeStyle = $derived.by(() => {
		const w = imageWidth;
		const h = imageHeight;
		if (!shouldConstrainImageSize || !w || !h) return undefined;
		return `max-height: ${h}px; max-width: ${w}px;`;
	});

	let textContent = $state<string | null>(null);

	$effect(() => {
		const isOpen = open;
		const type = previewType;
		const url = fileUrl;
		if (isOpen && type === 'text') {
			apiFetch<string>(url, { responseType: 'text' })
				.then((value) => {
					textContent = value;
				})
				.catch(() => {
					textContent = null;
				});
		}
	});

	async function refreshProxyState() {
		if (!open || !file.mimeType.startsWith('video/')) return;
		try {
			const latest = await api.files.get(libraryId, file.id);
			proxyStatus = latest.proxyStatus ?? null;
			proxyProgress = latest.proxyProgress ?? null;
			proxyEtaSeconds = latest.proxyEtaSeconds ?? null;
		} catch {
			// Leave the last-known state in place on a transient failure.
		}
	}

	async function refreshPlaybackSources() {
		if (!open || !file.mimeType.startsWith('video/')) return;
		try {
			const response = await api.files.playbackSources(libraryId, file.id);
			playbackSources = response.sources ?? [];
			const hasCurrentSelection = playbackSources.some(
				(source) => source.id === selectedPlaybackSourceId
			);
			selectedPlaybackSourceId = hasCurrentSelection
				? selectedPlaybackSourceId
				: response.defaultSourceId;
		} catch {
			playbackSources = [];
			selectedPlaybackSourceId = null;
		}
	}

	async function generateProxy() {
		if (!file.mimeType.startsWith('video/')) return;
		generatingProxy = true;
		try {
			await api.files.generateProxy(libraryId, file.id);
			await refreshProxyState();
		} finally {
			generatingProxy = false;
		}
	}

	let proxyPollTimer: ReturnType<typeof setInterval> | null = null;

	function stopProxyPolling() {
		if (!proxyPollTimer) return;
		clearInterval(proxyPollTimer);
		proxyPollTimer = null;
	}

	function startProxyPolling() {
		if (proxyPollTimer) return;
		proxyPollTimer = setInterval(() => {
			void refreshProxyState();
		}, 2000);
	}

	function downloadFile() {
		const link = document.createElement('a');
		link.href = apiUrl(`/api/libraries/${libraryId}/files/${file.id}?inline=true`);
		link.download = '';
		link.click();
	}

	// Navigation
	const currentIndex = $derived(files.findIndex((f) => f.id === file.id));
	const hasPrevious = $derived(currentIndex > 0);
	const hasNext = $derived(currentIndex >= 0 && currentIndex < files.length - 1);
	const previousFile = $derived(hasPrevious ? (files[currentIndex - 1] ?? null) : null);
	const nextFile = $derived(hasNext ? (files[currentIndex + 1] ?? null) : null);

	function goToPrevious() {
		if (hasPrevious) {
			imageLoaded = false;
			onnavigate?.(files[currentIndex - 1]!);
		}
	}

	function goToNext() {
		if (hasNext) {
			imageLoaded = false;
			onnavigate?.(files[currentIndex + 1]!);
		}
	}

	// Image fade-in state
	let imageLoaded = $state(false);

	function onImageLoad(event: Event) {
		const target = event.target;
		if (target instanceof HTMLImageElement) {
			loadedImageWidth = target.naturalWidth;
			loadedImageHeight = target.naturalHeight;
		}
		imageLoaded = true;
	}

	// Reset per-file state when the file changes.
	let lastFileId: string | undefined;
	$effect(() => {
		const id = file.id;
		if (id === lastFileId) return;
		lastFileId = id;
		proxyStatus = file.proxyStatus ?? null;
		proxyProgress = file.proxyProgress ?? null;
		proxyEtaSeconds = file.proxyEtaSeconds ?? null;
		imageLoaded = false;
		loadedImageWidth = null;
		loadedImageHeight = null;
		playbackSources = [];
		selectedPlaybackSourceId = null;
	});

	// History management for mouse-back-button support
	let popCount = $state(0);

	function pushPreviewHistory() {
		history.pushState({ filePreview: true }, '');
		popCount++;
	}

	function closePreview() {
		if (popCount > 0) {
			history.back();
		} else {
			open = false;
		}
	}

	function onPopstate() {
		if (popCount > 0) {
			popCount--;
			if (open) open = false;
		}
	}

	// Push a history entry + (re)load video proxy state when the preview opens or
	// the underlying file changes.
	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		const mimeType = file.mimeType;
		if (isOpen && !wasOpen) {
			pushPreviewHistory();
		}
		wasOpen = isOpen;

		if (!isOpen || !mimeType.startsWith('video/')) {
			stopProxyPolling();
			return;
		}
		void refreshProxyState();
		void refreshPlaybackSources();
	});

	// When a proxy finishes, refresh the playback source list.
	$effect(() => {
		if (proxyStatus === 'ready') {
			void refreshPlaybackSources();
		}
	});

	// Poll while a video proxy is being prepared.
	$effect(() => {
		if (videoProxyProcessing && open) {
			startProxyPolling();
		} else if (!videoProxyProcessing) {
			stopProxyPolling();
		}
	});

	// Preload adjacent images. Uses the shared "preview" variant so the lightbox
	// requests exactly the cache key the pre-warm job generated.
	function buildPreviewUrl(target: LibraryFile): string {
		const query = proxyQueryString(resolveVariant('preview', target.width, target.height));
		return apiUrl(`/api/files/proxy/${libraryId}/${target.id}?${query}`);
	}

	const previewImageUrl = $derived(buildPreviewUrl(file));

	// Hold refs to preloaded Image objects so GC cannot cancel in-flight requests.
	// Write-only (the holding IS the purpose); not reactive, so a plain let + `_`.
	let _preloadedImages: HTMLImageElement[] = [];

	$effect(() => {
		// Re-run on file change + open toggle.
		void file.id;
		if (!open) {
			_preloadedImages = [];
			return;
		}
		_preloadedImages = [previousFile, nextFile]
			.filter((f): f is LibraryFile => f !== null && f.mimeType.startsWith('image/'))
			.map((f) => {
				const img = new Image();
				img.crossOrigin = 'use-credentials';
				img.src = buildPreviewUrl(f);
				return img;
			});
	});

	// Focus management: the lightbox is a hand-rolled dialog (not Skeleton's
	// `Dialog`), so move focus into it on open and restore the trigger on close —
	// otherwise keyboard/AT users are dropped back at the top of the page.
	let dialogEl = $state<HTMLDivElement | null>(null);
	let previouslyFocused: HTMLElement | null = null;

	$effect(() => {
		if (open) {
			previouslyFocused = (document.activeElement as HTMLElement) ?? null;
			// dialogEl mounts during this render pass; focus once it exists.
			void tick().then(() => dialogEl?.focus());
		} else if (previouslyFocused) {
			previouslyFocused.focus();
			previouslyFocused = null;
		}
	});

	// Keyboard navigation
	//
	// F24 rework: guard by event.target so the lightbox's global ArrowLeft/
	// ArrowRight file-navigation doesn't fight controls that have their own
	// native meaning for those keys — the playback-source <select> (changes
	// the selected option) and the <video> (seeks) — both of which the Tab
	// trap below can legitimately focus.
	function isNavigableAwayFromControl(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLSelectElement ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLMediaElement
		);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (
			(event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
			isNavigableAwayFromControl(event.target)
		) {
			return;
		}
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			goToPrevious();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			goToNext();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			closePreview();
		} else if (event.key === 'Tab' && dialogEl) {
			// Trap Tab within the dialog.
			const focusables = [
				...dialogEl.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input, select, textarea, video, [tabindex]:not([tabindex="-1"])'
				)
			].filter((el) => el.offsetParent !== null || el === dialogEl);
			if (focusables.length === 0) {
				event.preventDefault();
				dialogEl.focus();
				return;
			}
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement as HTMLElement;
			if (event.shiftKey && (active === first || active === dialogEl)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('popstate', onPopstate);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('popstate', onPopstate);
		}
		stopProxyPolling();
	});
</script>

{#if open}
	<!-- Backdrop click closes; keyboard (Esc/arrows/Tab-trap) is handled globally in handleKeydown. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		bind:this={dialogEl}
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm focus:outline-none"
		role="dialog"
		aria-modal="true"
		aria-label={file.name}
		tabindex="-1"
		onclick={(e) => {
			if (e.target === e.currentTarget) closePreview();
		}}
	>
		<!-- Media content: fills the entire viewport -->
		{#if previewType === 'video'}
			<div class="flex h-full w-full items-center justify-center px-4 sm:px-16">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					class="w-full max-w-5xl rounded-md"
					src={videoSrc}
					title={file.name}
					crossorigin="use-credentials"
					playsinline
					autoplay
					controls
				>
					<source src={videoSrc} type={videoType} />
				</video>
			</div>
		{:else if previewType === 'audio'}
			<div class="flex h-full w-full items-center justify-center px-4 sm:px-16">
				<audio
					class="w-full max-w-2xl"
					src={videoSrc}
					title={file.name}
					crossorigin="use-credentials"
					controls
				>
					<source src={videoSrc} type={videoType} />
				</audio>
			</div>
		{:else if previewType === 'image'}
			<div class="flex h-full w-full items-center justify-center">
				<img
					src={previewImageUrl}
					alt={file.name}
					decoding="async"
					crossorigin="use-credentials"
					class="block max-h-full max-w-full object-contain transition-opacity duration-100 {imageLoaded
						? 'opacity-100'
						: 'opacity-0'}"
					style={imageSizeStyle}
					onload={onImageLoad}
				/>
			</div>
		{:else if previewType === 'pdf'}
			<div class="h-full w-full p-16">
				<iframe src={fileUrl} title={file.name} class="h-full w-full rounded-lg border-0"></iframe>
			</div>
		{:else if previewType === 'text'}
			<div class="flex h-full w-full items-center justify-center overflow-auto p-16">
				{#if textContent !== null}
					<pre
						class="w-full max-w-4xl self-start rounded-lg border border-white/20 bg-neutral-900/80 p-4 text-sm whitespace-pre-wrap text-white">{textContent}</pre>
				{:else}
					<div class="flex items-center justify-center">
						<AppIcon name={ICONS.loading} class="size-5 animate-spin text-white/60" />
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col items-center gap-4">
				<AppIcon name={getMimeIcon(file.mimeType)} class="size-24 text-white/40" />
				<p class="text-sm text-white/60">
					Preview not available for this file type ({file.mimeType})
				</p>
			</div>
		{/if}

		<!-- Overlay: top bar with close, filename, download -->
		<div
			class="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 py-3"
		>
			<div class="pointer-events-auto flex min-w-0 items-center gap-3">
				<button
					type="button"
					aria-label="Close preview"
					class="inline-flex size-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
					onclick={closePreview}
				>
					<AppIcon name={ICONS.close} class="size-5" />
				</button>
				<span class="truncate text-sm font-medium text-white">{file.name}</span>
				{#if previewType === 'video'}
					<div class="flex items-center gap-2">
						<Button
							size="sm"
							disabled={generatingProxy}
							onclick={generateProxy}
							class="bg-white/15 text-white hover:bg-white/25"
						>
							{#if generatingProxy}
								<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
							{:else}
								<AppIcon name={ICONS.movie} class="size-4" />
							{/if}
							<span>Create Proxy</span>
						</Button>
						{#if playbackSources.length > 0}
							<!--
								A native select, deliberately not the Select.* primitive: this
								control is media-playback logic (chooses the active video
								source), which is explicitly out of scope for this pass — only
								chrome/tokens change here.
							-->
							<select
								aria-label="Playback quality"
								class="max-w-48 rounded-md border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
								bind:value={selectedPlaybackSourceId}
							>
								{#each playbackSources as source (source.id)}
									<option value={source.id} class="bg-neutral-900 text-white">
										{source.kind === 'proxy' ? 'Proxy' : 'Source'} - {source.name}
									</option>
								{/each}
							</select>
						{/if}
					</div>
				{/if}
			</div>
			<button
				type="button"
				aria-label="Download file"
				class="pointer-events-auto inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
				onclick={downloadFile}
			>
				<AppIcon name={ICONS.download} class="size-5" />
			</button>
		</div>

		{#if videoProxyProcessing}
			<div
				class="absolute top-14 left-1/2 z-20 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-white/15 bg-black/65 p-3 backdrop-blur-sm"
			>
				<div class="mb-2 flex items-center justify-between text-xs text-white/80">
					<span>Preparing video preview</span>
					<span class="font-semibold">{videoProxyProgressPercent}%</span>
				</div>
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
					<div
						class="h-full rounded-full bg-primary transition-[width] duration-300"
						style="width: {videoProxyProgressPercent}%"
					></div>
				</div>
				{#if videoProxyEtaLabel}
					<p class="mt-1 text-xs text-white/70">ETA {videoProxyEtaLabel}</p>
				{/if}
			</div>
		{/if}

		<!-- Overlay: previous button -->
		{#if hasPrevious}
			<button
				type="button"
				aria-label="Previous file"
				class="absolute top-1/2 left-4 z-20 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/70"
				onclick={goToPrevious}
			>
				<AppIcon name={ICONS.chevronLeft} class="size-5" />
			</button>
		{/if}

		<!-- Overlay: next button -->
		{#if hasNext}
			<button
				type="button"
				aria-label="Next file"
				class="absolute top-1/2 right-4 z-20 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/70"
				onclick={goToNext}
			>
				<AppIcon name={ICONS.chevronRight} class="size-5" />
			</button>
		{/if}
	</div>
{/if}
