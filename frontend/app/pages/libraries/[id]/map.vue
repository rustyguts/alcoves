<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { onMounted, ref } from "vue";
import { useLibraryMap } from "~/composables/useLibraryMap";
import { api } from "~/api";
import type { LibraryFile, MapPoint } from "~~/shared/types/api";
import AppIcon from "~/components/AppIcon.vue";
import FilePreview from "~/components/FilePreview.vue";

definePageMeta({ layout: "library" });

const route = useRoute();
const libraryId = computed(() => route.params.id as string);

const map = useLibraryMap(libraryId);

const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);

// Ordered, lightweight LibraryFile records for every geotagged point so the
// lightbox can page through the whole map. Map points are a thin DTO, so the
// displayed file is always (re)fetched in full on open and on navigate.
const previewFiles = computed<LibraryFile[]>(() =>
  map.points.value.map((p) => ({
    id: p.id,
    libraryId: libraryId.value,
    parentFolderId: null,
    name: p.name,
    kind: "file",
    mimeType: "",
    size: 0,
    duration: null,
    width: null,
    height: null,
    proxyStatus: null,
    thumbnailFileId: p.thumbnailFileId,
    sourceFileId: null,
    originalCreatedAt: null,
    capturedAt: p.capturedAt,
    gpsLat: p.lat,
    gpsLon: p.lon,
    hash: null,
    trashedAt: null,
    createdAt: p.capturedAt ?? "",
    updatedAt: p.capturedAt ?? "",
    owner: null,
    tags: [],
  })),
);

// Map points are a thin DTO; fetch the full file before opening the lightbox.
async function onSelect(point: MapPoint) {
  try {
    const file = await api.files.get(libraryId.value, point.id);
    previewFile.value = file;
    previewOpen.value = true;
  } catch {
    // Ignore — file may have been removed since the map loaded.
  }
}

// Lightbox prev/next emits one of the thin previewFiles records — refetch it in
// full so the preview has real mime/proxy data, mirroring onSelect.
async function onNavigate(file: LibraryFile) {
  try {
    previewFile.value = await api.files.get(libraryId.value, file.id);
  } catch {
    // Ignore — file may have been removed since the map loaded.
  }
}

function handleFileUpdate(updated: LibraryFile) {
  if (previewFile.value?.id === updated.id) {
    previewFile.value = { ...previewFile.value, ...updated };
  }
}

onMounted(() => {
  void map.load();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-default">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-default">Map</h2>
        <p class="text-xs text-muted mt-0.5">Where your photos were taken.</p>
      </div>
      <span v-if="map.points.value.length > 0" class="text-xs text-muted shrink-0">
        {{ map.points.value.length }} geotagged
      </span>
    </div>

    <div
      v-if="map.truncated.value"
      class="px-4 py-2 text-xs text-warning bg-warning/10 border-b border-default"
    >
      Showing the most recent {{ map.points.value.length }} geotagged files. Some points are not
      displayed.
    </div>

    <div class="relative flex-1 min-h-0">
      <!-- Loading -->
      <div
        v-if="map.loading.value && map.points.value.length === 0"
        class="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted"
      >
        <AppIcon :name="ICONS.loading" class="size-5 animate-spin" />
      </div>

      <!-- Error -->
      <div
        v-else-if="map.error.value"
        class="absolute inset-0 z-10 flex items-center justify-center px-4 text-center text-sm text-error"
      >
        {{ map.error.value }}
      </div>

      <!-- Empty -->
      <div
        v-else-if="!map.loading.value && map.points.value.length === 0"
        class="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 text-center text-sm text-muted"
      >
        <AppIcon :name="ICONS.location" class="size-8 mb-3 opacity-40" />
        <p>No geotagged photos yet.</p>
        <p class="mt-1 text-xs">
          Photos with GPS metadata appear here once their location is extracted.
        </p>
      </div>

      <!-- Map (client-only component). Only mounted once there are points to
           plot, so an empty/loading library never fetches map tiles. -->
      <LibraryMap
        v-if="map.points.value.length > 0"
        :points="map.points.value"
        class="absolute inset-0"
        @select="onSelect"
      />
    </div>

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId"
      :files="previewFiles"
      @navigate="onNavigate"
      @update:file="handleFileUpdate"
    />
  </div>
</template>
