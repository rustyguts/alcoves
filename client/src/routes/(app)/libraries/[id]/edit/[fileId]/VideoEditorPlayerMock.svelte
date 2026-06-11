<script lang="ts">
	// Test-only stand-in for VideoEditorPlayer. The real component pulls in the
	// Vidstack runtime (heavy, browser-only), so the editor page's unit test
	// mocks it with this. It mirrors the real component's contract: the state
	// callback props plus the imperative PlaybackController handed up through
	// `oncontroller` (seek/togglePlay/play/pause/setRate/setMuted/setVolume/
	// enterFullscreen), so the page's playback store can call through without
	// throwing.
	import type { PlaybackController } from '$lib/state/playback.svelte';

	let {
		oncurrenttimeupdate,
		ondurationupdate,
		onpausedupdate,
		onratechange,
		onvolumechange,
		oncontroller
	}: {
		oncurrenttimeupdate?: (v: number) => void;
		ondurationupdate?: (v: number) => void;
		onpausedupdate?: (v: boolean) => void;
		onratechange?: (v: number) => void;
		onvolumechange?: (volume: number, muted: boolean) => void;
		oncontroller?: (controller: PlaybackController) => void;
	} = $props();

	let paused = true;

	export function seek(seconds: number) {
		oncurrenttimeupdate?.(seconds);
	}

	export function play() {
		paused = false;
		onpausedupdate?.(false);
	}

	export function pause() {
		paused = true;
		onpausedupdate?.(true);
	}

	export function togglePlay() {
		if (paused) play();
		else pause();
	}

	export function setRate(rate: number) {
		onratechange?.(rate);
	}

	export function setMuted(muted: boolean) {
		onvolumechange?.(1, muted);
	}

	export function setVolume(volume: number) {
		onvolumechange?.(volume, false);
	}

	export function enterFullscreen() {}

	// Publish a known duration and the controller on mount so the page (and the
	// real Timeline it renders) have non-zero pixel math, mirroring a loaded
	// video.
	$effect(() => {
		ondurationupdate?.(42);
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

<div data-testid="player-stub">player</div>
