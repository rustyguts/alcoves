<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { MapPoint } from "~~/shared/types/api";

// Leaflet types only — the runtime modules are dynamically imported in onMounted
// so they never run during SSR (they touch window/document).
import type { Map as LeafletMap, MarkerClusterGroup } from "leaflet";

const props = defineProps<{
  points: MapPoint[];
}>();

const emit = defineEmits<{
  select: [point: MapPoint];
}>();

const config = useRuntimeConfig();
const mapEl = ref<HTMLElement | null>(null);

// Module handle + map/cluster instances kept across renders.
let L: typeof import("leaflet") | null = null;
let map: LeafletMap | null = null;
let cluster: MarkerClusterGroup | null = null;

// Emerald dot icon built from inline HTML — avoids Leaflet's default marker
// image assets (which break under bundlers) and works with markercluster.
function dotIcon() {
  if (!L) return undefined;
  return L.divIcon({
    className: "alcoves-map-marker",
    html: '<span style="display:block;width:14px;height:14px;border-radius:9999px;background:#10b981;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.35)"></span>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function renderMarkers() {
  if (!L || !map) return;

  if (cluster) {
    cluster.clearLayers();
    map.removeLayer(cluster);
    cluster = null;
  }

  if (props.points.length === 0) return;

  cluster = L.markerClusterGroup({ chunkedLoading: true });
  const latlngs: [number, number][] = [];

  for (const p of props.points) {
    const marker = L.marker([p.lat, p.lon], { icon: dotIcon() });
    marker.bindTooltip(p.name, { direction: "top" });
    marker.on("click", () => emit("select", p));
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

onMounted(async () => {
  if (!import.meta.client || !mapEl.value) return;

  // Dynamic imports keep Leaflet out of the SSR bundle.
  L = await import("leaflet");
  await import("leaflet.markercluster");
  await import("leaflet/dist/leaflet.css");
  await import("leaflet.markercluster/dist/MarkerCluster.css");
  await import("leaflet.markercluster/dist/MarkerCluster.Default.css");

  map = L.map(mapEl.value, { worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer(config.public.mapTileUrl as string, {
    attribution: config.public.mapTileAttribution as string,
    maxZoom: 19,
  }).addTo(map);

  renderMarkers();
});

watch(
  () => props.points,
  () => renderMarkers(),
  { deep: true },
);

onBeforeUnmount(() => {
  map?.remove();
  map = null;
  cluster = null;
});
</script>

<template>
  <div ref="mapEl" class="h-full w-full" />
</template>
