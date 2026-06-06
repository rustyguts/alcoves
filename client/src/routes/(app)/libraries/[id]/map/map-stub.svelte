<!-- Test-only stub for LibraryMap: exposes a clickable marker per point so the
     map page test can drive the page's onSelect handler without dynamically
     importing Leaflet / fetching tiles. -->
<script lang="ts">
	import type { MapPoint } from '$lib/types/api';

	interface Props {
		points: MapPoint[];
		onselect?: (point: MapPoint) => void;
	}

	let { points, onselect }: Props = $props();
</script>

<div data-testid="map-stub">
	{#each points as point (point.id)}
		<button type="button" data-testid="map-marker" onclick={() => onselect?.(point)}>
			{point.name}
		</button>
	{/each}
</div>
