<script lang="ts">
	// Test-only stand-in for VideoEditorPlayer. The real component pulls in the
	// Vidstack runtime (heavy, browser-only), so the editor page's unit test mocks
	// it with this. It mirrors the imperative surface the page binds via
	// `bind:this` — `seek` / `togglePlay` — so the page's onSeek/onTogglePlay
	// handlers can call through without throwing.
	let {
		oncurrenttimeupdate,
		ondurationupdate
	}: {
		oncurrenttimeupdate?: (v: number) => void;
		ondurationupdate?: (v: number) => void;
	} = $props();

	// Publish a known duration on mount so the page (and the real MomentTimeline it
	// renders) have non-zero pixel math, mirroring a loaded video.
	$effect(() => {
		ondurationupdate?.(42);
	});

	export function seek(seconds: number) {
		oncurrenttimeupdate?.(seconds);
	}

	export function togglePlay() {
		oncurrenttimeupdate?.(0);
	}
</script>

<div data-testid="player-stub">player</div>
