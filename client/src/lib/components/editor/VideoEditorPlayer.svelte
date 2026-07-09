<script lang="ts">
	/**
	 * VideoEditorPlayer — chrome-less Vidstack surface for the editor.
	 *
	 * The editor renders NO on-video controls: the TransportBar below the stage
	 * is the single control surface, so this component is just the media frame —
	 * `<media-player>` + `<media-provider>` with no layout element. Clicking the
	 * frame toggles play (Space does the same via the global shortcut map).
	 *
	 * The Vidstack runtime touches `window`/custom-element registration, so the
	 * player modules are dynamically imported inside `onMount` (guarded by
	 * `browser`) and never run during SSR. The surface is letterboxed inside a
	 * 16:9 frame whose pixel size is measured by a ResizeObserver, so vertical/
	 * square/odd sources fit without clipping or stretching.
	 *
	 * State flows out via callback props (time/duration/paused/rate/volume); an
	 * imperative controller — seek/togglePlay/play/pause/setRate/setMuted/
	 * setVolume/enterFullscreen — is available both as bind:this exports and via
	 * the `oncontroller` callback.
	 */
	import { onMount, onDestroy, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { api } from '$lib/api';
	import { apiUrl } from '$lib/api';
	import type { LibraryFile, PlaybackSource } from '$lib/types/api';
	import type { PlaybackController } from '$lib/state/playback.svelte';

	interface Props {
		file: LibraryFile;
		libraryId: string;
		active?: boolean;
		oncurrenttimeupdate?: (value: number) => void;
		ondurationupdate?: (value: number) => void;
		onpausedupdate?: (value: boolean) => void;
		onratechange?: (value: number) => void;
		onvolumechange?: (volume: number, muted: boolean) => void;
		oncontroller?: (controller: PlaybackController) => void;
	}

	let {
		file,
		libraryId,
		active = false,
		oncurrenttimeupdate,
		ondurationupdate,
		onpausedupdate,
		onratechange,
		onvolumechange,
		oncontroller
	}: Props = $props();

	type VidstackPlayer = HTMLElement & {
		currentTime?: number;
		duration?: number;
		paused?: boolean;
		playbackRate?: number;
		muted?: boolean;
		volume?: number;
		play?: () => Promise<void>;
		pause?: () => void;
		enterFullscreen?: () => Promise<void>;
		requestFullscreen?: () => Promise<void>;
		subscribe?: (
			cb: (state: {
				currentTime: number;
				duration: number;
				paused: boolean;
				playbackRate: number;
				muted: boolean;
				volume: number;
			}) => void
		) => () => void;
	};

	let playerReady = $state(false);
	let playbackSources = $state<PlaybackSource[]>([]);
	let selectedPlaybackSourceId = $state<string | null>(null);
	let playerEl = $state<HTMLElement | null>(null);

	let currentTime = $state(0);
	// Seed `duration` from the file's known duration (snapshot of the initial
	// prop). Later changes flow through the file-duration $effect below.
	// svelte-ignore state_referenced_locally
	let duration = $state(file.duration ?? 0);
	let paused = $state(true);
	let rate = $state(1);
	let muted = $state(false);
	let volume = $state(1);

	const isAudio = $derived(!!file.mimeType && file.mimeType.startsWith('audio/'));

	// Letterbox the actual surface via object-contain inside a 16:9 frame.
	const FRAME_ASPECT = 16 / 9;

	// Outer container fills its cell; the inner frame is sized to the largest
	// 16:9 box that fits, measured with a ResizeObserver (pure-CSS approaches
	// clip or break the ratio when the cell is short-and-wide vs tall-and-narrow).
	let wrapperEl = $state<HTMLElement | null>(null);
	let frameEl = $state<HTMLElement | null>(null);
	let frameWidth = $state(0);
	let frameHeight = $state(0);

	function recomputeFrame() {
		const el = wrapperEl;
		if (!el) return;
		const w = el.clientWidth;
		const h = el.clientHeight;
		if (!w || !h) return;
		if (w / h > FRAME_ASPECT) {
			frameHeight = h;
			frameWidth = h * FRAME_ASPECT;
		} else {
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
			const unsub = el.subscribe(
				({ currentTime: ct, duration: d, paused: p, playbackRate: r, muted: m, volume: v }) => {
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
					if (typeof r === 'number' && r > 0 && r !== rate) {
						rate = r;
						onratechange?.(r);
					}
					if ((typeof v === 'number' && v !== volume) || (typeof m === 'boolean' && m !== muted)) {
						if (typeof v === 'number') volume = v;
						if (typeof m === 'boolean') muted = m;
						onvolumechange?.(volume, muted);
					}
				}
			);
			unsubs = [unsub];
			return;
		}

		// DOM-event fallback for environments without the state subscription.
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

	// (re)bind player listeners whenever the element or readiness changes. The
	// attach call is untracked: Vidstack's subscribe fires synchronously with
	// the current state, and the callback reads the local $state diffs — left
	// tracked, every media tick would tear down and rebuild the subscription.
	$effect(() => {
		const el = playerEl;
		const ready = playerReady;
		if (unsubs.length) {
			unsubs.forEach((fn) => fn());
			unsubs = [];
		}
		if (el && ready) untrack(() => attachPlayerListeners(el as VidstackPlayer));
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
		// Surface the seeded metadata duration immediately. The change guards
		// below only emit on *difference*, and the media's real duration often
		// equals the stored one exactly — without this initial emit the page
		// would never learn the duration at all.
		if (duration > 0) ondurationupdate?.(duration);
		(async () => {
			await import('vidstack/player');
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

	export function play() {
		const el = playerEl as VidstackPlayer | null;
		void el?.play?.();
	}

	export function pause() {
		const el = playerEl as VidstackPlayer | null;
		el?.pause?.();
	}

	export function togglePlay() {
		const el = playerEl as VidstackPlayer | null;
		if (!el) return;
		if (el.paused) void el.play?.();
		else el.pause?.();
	}

	export function setRate(value: number) {
		const el = playerEl as VidstackPlayer | null;
		if (el) el.playbackRate = value;
	}

	export function setMuted(value: boolean) {
		const el = playerEl as VidstackPlayer | null;
		if (el) el.muted = value;
	}

	export function setVolume(value: number) {
		const el = playerEl as VidstackPlayer | null;
		if (el) el.volume = Math.min(1, Math.max(0, value));
	}

	export function enterFullscreen() {
		const el = playerEl as VidstackPlayer | null;
		if (!el) return;
		if (typeof el.enterFullscreen === 'function') void el.enterFullscreen();
		else if (typeof frameEl?.requestFullscreen === 'function') void frameEl.requestFullscreen();
	}

	// Hand the imperative controller to any parent that wants it without
	// bind:this — only once the Vidstack element actually exists, so a transport
	// click during the loading spinner can't silently no-op against a null el.
	$effect(() => {
		if (!playerReady || !playerEl) return;
		oncontroller?.({
			seek,
			togglePlay,
			play,
			pause,
			setRate,
			setMuted,
			setVolume,
			enterFullscreen
		});
	});
</script>

<!--
	Outer wrapper fills its cell; the ResizeObserver writes pixel dimensions
	onto the inner frame so the largest 16:9 box fits without clipping. The
	video letterboxes via object-contain inside that frame. Clicking the frame
	toggles play — keyboard users get the same via Space/K on the global keymap.
-->
<div bind:this={wrapperEl} class="relative flex h-full w-full items-center justify-center">
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		bind:this={frameEl}
		class="relative flex items-center justify-center overflow-hidden rounded-lg bg-black"
		style:width={frameWidth ? `${frameWidth}px` : '100%'}
		style:height={frameHeight ? `${frameHeight}px` : 'auto'}
		onclick={togglePlay}
	>
		{#if playerReady}
			<!-- key-disabled: the editor owns ALL keyboard input — Vidstack's own
			     keymap would otherwise hijack M (mute), I (PiP), F (fullscreen)
			     whenever the player surface has focus. -->
			<media-player
				bind:this={playerEl}
				class="player h-full w-full"
				src={mediaSrc}
				title={file.name}
				crossorigin="use-credentials"
				playsinline
				key-disabled
			>
				<media-provider></media-provider>
			</media-player>
			{#if isAudio}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center"
					data-testid="audio-backdrop"
				>
					<AppIcon name={ICONS.music} class="size-16 text-white/25" />
				</div>
			{/if}
		{:else}
			<div class="flex items-center justify-center py-16">
				<AppIcon name={ICONS.loading} class="size-6 animate-spin text-white/60" />
			</div>
		{/if}
		{#if active}
			<div
				class="pointer-events-none absolute inset-0 z-10 rounded-lg border-4 border-primary transition-opacity"
			></div>
		{/if}
	</div>
</div>

<style>
	.player {
		--media-border-radius: 0;
	}
	/* Force the inner <video> to letterbox inside the frame regardless of source
	 * aspect ratio. */
	.player :global(video) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
</style>
