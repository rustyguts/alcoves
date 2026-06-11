<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import type { MapPoint } from '$lib/types/api';

	// Leaflet types only — the runtime modules are dynamically imported inside
	// onMount so they never run during SSR (they touch window/document).
	import type { Map as LeafletMap, MarkerClusterGroup } from 'leaflet';

	interface Props {
		points: MapPoint[];
		onselect?: (point: MapPoint) => void;
	}

	let { points, onselect }: Props = $props();

	const TILE_URL = env.PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
	const TILE_ATTRIBUTION = env.PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors';

	let mapEl: HTMLElement | null = $state(null);

	// Module handle + map/cluster instances kept across renders.
	let L: typeof import('leaflet') | null = null;
	let map: LeafletMap | null = null;
	let cluster: MarkerClusterGroup | null = null;
	let ready = $state(false);

	// Emerald dot icon built from inline HTML — avoids Leaflet's default marker
	// image assets (which break under bundlers) and works with markercluster.
	function dotIcon() {
		if (!L) return undefined;
		return L.divIcon({
			className: 'alcoves-map-marker',
			html: '<span style="display:block;width:14px;height:14px;border-radius:9999px;background:#10b981;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></span>',
			iconSize: [14, 14],
			iconAnchor: [7, 7]
		});
	}

	function renderMarkers() {
		if (!L || !map) return;

		if (cluster) {
			cluster.clearLayers();
			map.removeLayer(cluster);
			cluster = null;
		}

		if (points.length === 0) return;

		cluster = L.markerClusterGroup({ chunkedLoading: true });
		const latlngs: [number, number][] = [];

		for (const p of points) {
			const marker = L.marker([p.lat, p.lon], { icon: dotIcon() });
			marker.bindTooltip(p.name, { direction: 'top' });
			marker.on('click', () => onselect?.(p));
			cluster.addLayer(marker);
			latlngs.push([p.lat, p.lon]);
		}

		map.addLayer(cluster);
		if (latlngs.length === 1) {
			map.setView(latlngs[0]!, 14);
		} else {
			map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
		}
	}

	onMount(async () => {
		if (!browser || !mapEl) return;

		// Dynamic imports keep Leaflet out of the SSR bundle.
		L = (await import('leaflet')).default ?? (await import('leaflet'));
		await import('leaflet.markercluster');
		await import('leaflet/dist/leaflet.css');
		await import('leaflet.markercluster/dist/MarkerCluster.css');
		await import('leaflet.markercluster/dist/MarkerCluster.Default.css');

		map = L.map(mapEl, { worldCopyJump: true }).setView([20, 0], 2);
		L.tileLayer(TILE_URL, {
			attribution: TILE_ATTRIBUTION,
			maxZoom: 19
		}).addTo(map);

		ready = true;
		renderMarkers();
	});

	// Re-render markers whenever the points change (after the map is ready).
	$effect(() => {
		// Touch `points` and `ready` so the effect re-runs on either change.
		void points;
		if (ready) renderMarkers();
	});

	onDestroy(() => {
		map?.remove();
		map = null;
		cluster = null;
	});
</script>

<div bind:this={mapEl} class="h-full w-full"></div>
