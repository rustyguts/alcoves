<script lang="ts">
	/**
	 * VideoEditorPlayer — Vidstack-backed video surface for the editor.
	 *
	 * The Vidstack runtime touches `window`/custom-element registration, so the
	 * player modules are dynamically imported inside `onMount` (guarded by
	 * `browser`) and never run during SSR. Svelte renders the `media-*` custom
	 * elements natively — no extra config needed.
	 *
	 * The player surface is letterboxed inside a 16:9 frame whose pixel size is
	 * measured by a ResizeObserver, so vertical/square/odd sources fit without
	 * clipping or stretching. Player time/duration/pause changes are surfaced via
	 * callback props; `seek`/`togglePlay` are exported for `bind:this` (and also
	 * handed out through `oncontroller`).
	 */
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { api } from '$lib/api';
	import { apiUrl } from '$lib/api';
	import type { LibraryFile, PlaybackSource } from '$lib/types/api';

	interface Controller {
		seek: (seconds: number) => void;
		togglePlay: () => void;
	}

	interface Props {
		file: LibraryFile;
		libraryId: string;
		active?: boolean;
		oncurrenttimeupdate?: (value: number) => void;
		ondurationupdate?: (value: number) => void;
		onpausedupdate?: (value: boolean) => void;
		oncontroller?: (controller: Controller) => void;
	}

	let {
		file,
		libraryId,
		active = false,
		oncurrenttimeupdate,
		ondurationupdate,
		onpausedupdate,
		oncontroller
	}: Props = $props();

	type VidstackPlayer = HTMLElement & {
		currentTime?: number;
		duration?: number;
		paused?: boolean;
		play?: () => Promise<void>;
		pause?: () => void;
		subscribe?: (
			cb: (state: { currentTime: number; duration: number; paused: boolean }) => void
		) => () => void;
	};

	let playerReady = $state(false);
	let playbackSources = $state<PlaybackSource[]>([]);
	let selectedPlaybackSourceId = $state<string | null>(null);
	let playerEl = $state<HTMLElement | null>(null);

	let currentTime = $state(0);
	// Seed `duration` from the file's known duration (snapshot of the initial
	// prop, mirroring the original `ref(file.duration ?? 0)`). Later changes flow
	// through the file-duration `$effect` below, so capturing only the initial
	// value here is intentional.
	// svelte-ignore state_referenced_locally
	let duration = $state(file.duration ?? 0);
	let paused = $state(true);

	// Aspect ratio of the frame box. Vidstack's default video layout draws
	// chrome (controls, gradients) inside the player surface, so we letterbox
	// the actual <video> via object-contain inside a 16:9 frame.
	const FRAME_ASPECT = 16 / 9;

	// Outer container fills its grid cell; we then size an inner frame to the
	// largest 16:9 box that fits inside that cell. Pure-CSS approaches with
	// aspect-ratio + max-w/max-h end up either clipping or breaking the ratio
	// when the cell is short and wide vs tall and narrow, so we measure with
	// ResizeObserver and write px dimensions back to an inline style.
	let wrapperEl = $state<HTMLElement | null>(null);
	let frameWidth = $state(0);
	let frameHeight = $state(0);

	function recomputeFrame() {
		const el = wrapperEl;
		if (!el) return;
		const w = el.clientWidth;
		const h = el.clientHeight;
		if (!w || !h) return;
		if (w / h > FRAME_ASPECT) {
			// cell wider than 16:9 → height-bound, derive width
			frameHeight = h;
			frameWidth = h * FRAME_ASPECT;
		} else {
			// cell taller-or-equal to 16:9 → width-bound, derive height
			frameWidth = w;
			frameHeight = w / FRAME_ASPECT;
		}
	}

	let resizeObserver: ResizeObserver | null = null;

	const fileUrl = $derived(apiUrl(`/api/libraries/${libraryId}/files/${file.id}?inline=true`));

	const selectedPlaybackSource = $derived.by<PlaybackSource | null>(() => {
		if (!selectedPlaybackSourceId) return null;
		return playbackSources.find((s) => s.id === selectedPlaybackSourceId) ?? null;
	});

	const videoSrc = $derived.by(() => {
		const fromSource = selectedPlaybackSource?.streamUrl;
		if (fromSource) return apiUrl(fromSource);
		return fileUrl;
	});

	const mediaSrc = $derived.by(
		() =>
			({
				src: videoSrc,
				type: selectedPlaybackSource?.mimeType ?? file.mimeType
			}) as unknown as { src: string; type: string }
	);

	async function refreshPlaybackSources() {
		try {
			const response = await api.files.playbackSources(libraryId, file.id);
			playbackSources = response.sources ?? [];
			selectedPlaybackSourceId = response.defaultSourceId ?? null;
		} catch {
			playbackSources = [];
			selectedPlaybackSourceId = null;
		}
	}

	let unsubs: Array<() => void> = [];

	function attachPlayerListeners(el: VidstackPlayer) {
		if (typeof el.subscribe === 'function') {
			const unsub = el.subscribe(({ currentTime: ct, duration: d, paused: p }) => {
				if (typeof ct === 'number' && ct !== currentTime) {
					currentTime = ct;
					oncurrenttimeupdate?.(ct);
				}
				if (typeof d === 'number' && Number.isFinite(d) && d > 0 && d !== duration) {
					duration = d;
					ondurationupdate?.(d);
				}
				if (typeof p === 'boolean' && p !== paused) {
					paused = p;
					onpausedupdate?.(p);
				}
			});
			unsubs = [unsub];
			return;
		}

		const onTime = () => {
			const ct = el.currentTime;
			if (typeof ct === 'number') {
				currentTime = ct;
				oncurrenttimeupdate?.(ct);
			}
		};
		const onDur = () => {
			const d = el.duration;
			if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
				duration = d;
				ondurationupdate?.(d);
			}
		};
		const onPlay = () => {
			paused = false;
			onpausedupdate?.(false);
		};
		const onPause = () => {
			paused = true;
			onpausedupdate?.(true);
		};

		el.addEventListener('time-update', onTime);
		el.addEventListener('duration-change', onDur);
		el.addEventListener('loaded-metadata', onDur);
		el.addEventListener('play', onPlay);
		el.addEventListener('pause', onPause);

		unsubs = [
			() => el.removeEventListener('time-update', onTime),
			() => el.removeEventListener('duration-change', onDur),
			() => el.removeEventListener('loaded-metadata', onDur),
			() => el.removeEventListener('play', onPlay),
			() => el.removeEventListener('pause', onPause)
		];
	}

	// (re)bind player listeners whenever the element or readiness changes.
	$effect(() => {
		const el = playerEl;
		const ready = playerReady;
		if (unsubs.length) {
			unsubs.forEach((fn) => fn());
			unsubs = [];
		}
		if (el && ready) attachPlayerListeners(el as VidstackPlayer);
	});

	// Re-emit duration when the file's own duration becomes available/changes.
	$effect(() => {
		const d = file.duration;
		if (typeof d === 'number' && Number.isFinite(d) && d > 0 && d !== duration) {
			duration = d;
			ondurationupdate?.(d);
		}
	});

	onMount(() => {
		if (!browser) return;
		if (wrapperEl && typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(recomputeFrame);
			resizeObserver.observe(wrapperEl);
			recomputeFrame();
		}
		(async () => {
			await import('vidstack/player');
			await import('vidstack/player/layouts');
			await import('vidstack/player/ui');
			playerReady = true;
			await refreshPlaybackSources();
		})();
	});

	onDestroy(() => {
		unsubs.forEach((fn) => fn());
		unsubs = [];
		resizeObserver?.disconnect();
		resizeObserver = null;
	});

	export function seek(seconds: number) {
		const el = playerEl as VidstackPlayer | null;
		if (el) el.currentTime = Math.max(0, seconds);
	}

	export function togglePlay() {
		const el = playerEl as VidstackPlayer | null;
		if (!el) return;
		if (el.paused) void el.play?.();
		else el.pause?.();
	}

	// Hand the imperative controller to any parent that wants it without bind:this.
	$effect(() => {
		oncontroller?.({ seek, togglePlay });
	});
</script>

<!--
	Outer wrapper fills its grid cell. ResizeObserver measures the cell's content
	box on every layout change and writes pixel dimensions onto the inner frame so
	the largest possible 16:9 box fits without clipping. The video itself uses
	object-contain inside that frame so vertical / square / odd sources letterbox
	instead of being cropped or stretched.
-->
<div bind:this={wrapperEl} class="relative flex w-full items-center justify-center">
	<div
		class="relative flex items-center justify-center overflow-hidden rounded-lg bg-black"
		style:width={frameWidth ? `${frameWidth}px` : '100%'}
		style:height={frameHeight ? `${frameHeight}px` : 'auto'}
	>
		{#if playerReady}
			<media-player
				bind:this={playerEl}
				class="player h-full w-full"
				src={mediaSrc}
				title={file.name}
				crossorigin="use-credentials"
				playsinline
			>
				<media-provider></media-provider>
				<media-video-layout></media-video-layout>
			</media-player>
		{:else}
			<div class="flex items-center justify-center py-16">
				<AppIcon name={ICONS.loading} class="size-6 animate-spin text-white/60" />
			</div>
		{/if}
		{#if active}
			<div
				class="pointer-events-none absolute inset-0 z-10 rounded-lg border-4 border-primary-500 transition-opacity"
			></div>
		{/if}
	</div>
</div>

<style>
	.player {
		--media-border-radius: 0;
	}
	/* Force the inner <video> to letterbox inside the frame regardless of source
	 * aspect ratio. Vidstack's default fits to the player element (already 16:9),
	 * but a vertical source would stretch without an explicit object-fit override. */
	.player :global(video) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
