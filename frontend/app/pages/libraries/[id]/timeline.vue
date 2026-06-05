<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useLibraryTimeline, type TimelineGroup } from "~/composables/useLibraryTimeline";
import type { LibraryFile } from "~~/shared/types/api";
import type { GalleryGroup, GalleryItem } from "~/utils/gallery-types";
import AppIcon from "~/components/AppIcon.vue";
import FilePreview from "~/components/FilePreview.vue";
import JustifiedGallery from "~/components/JustifiedGallery.vue";

definePageMeta({ layout: "library" });

const route = useRoute();
const libraryId = computed(() => route.params.id as string);

const timeline = useLibraryTimeline(libraryId);

const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);

function isImage(f: LibraryFile): boolean {
  return f.mimeType.startsWith("image/");
}
function isVideo(f: LibraryFile): boolean {
  return f.mimeType.startsWith("video/");
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
  previewFile.value = file;
  previewOpen.value = true;
}

function handleFileUpdate(updated: LibraryFile) {
  if (previewFile.value?.id === updated.id) {
    previewFile.value = { ...previewFile.value, ...updated };
  }
}

const thisYear = new Date().getUTCFullYear();

// Map the composable's day groups into gallery groups, attaching a large month
// heading at each month boundary (groups arrive newest-first).
const galleryGroups = computed<GalleryGroup<LibraryFile>[]>(() => {
  let lastMonth = "";
  return timeline.groups.value.map((g: TimelineGroup) => {
    const d = dayDate(g.key);
    const monthKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const sectionLabel = monthKey !== lastMonth ? formatMonth(d) : null;
    lastMonth = monthKey;
    return {
      key: g.key,
      sectionLabel,
      heading: formatDay(d),
      count: g.files.length,
      items: g.files.map(
        (f): GalleryItem<LibraryFile> => ({
          id: f.id,
          libraryId: libraryId.value,
          thumbnailFileId: thumbId(f),
          aspect: aspectOf(f),
          mime: f.mimeType,
          name: f.name,
          isVideo: isVideo(f),
          sourceWidth: f.width,
          sourceHeight: f.height,
          raw: f,
        }),
      ),
    };
  });
});

// `Y-M-D` (UTC) key → Date. Month is the 0-based value emitted by the composable.
function dayDate(key: string): Date {
  const [y, m, day] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, m ?? 0, day ?? 1));
}

function formatMonth(d: Date): string {
  if (Number.isNaN(d.getTime())) return "Unknown";
  const sameYear = d.getUTCFullYear() === thisYear;
  return d.toLocaleDateString("en-US", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function formatDay(d: Date): string {
  if (Number.isNaN(d.getTime())) return "Unknown date";
  const sameYear = d.getUTCFullYear() === thisYear;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

// Infinite scroll: observe a sentinel near the bottom and pull the next page.
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(async () => {
  await timeline.loadFirst();
  if (sentinel.value) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) timeline.loadMore();
      },
      { rootMargin: "800px" },
    );
    observer.observe(sentinel.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-default">
      <div class="min-w-0">
        <h2 class="text-base font-semibold text-default">Timeline</h2>
        <p class="text-xs text-muted mt-0.5">
          {{ timeline.totalCount.value }}
          {{ timeline.typeFilter.value === "media" ? "photos & videos" : "files" }}, newest first.
        </p>
      </div>

      <!-- Media / all toggle -->
      <div class="flex items-center rounded-md border border-default overflow-hidden shrink-0">
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium transition-colors"
          :class="
            timeline.typeFilter.value === 'media'
              ? 'bg-primary/15 text-primary'
              : 'text-muted hover:text-default'
          "
          @click="timeline.setType('media')"
        >
          Photos &amp; videos
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm font-medium border-l border-default transition-colors"
          :class="
            timeline.typeFilter.value === 'all'
              ? 'bg-primary/15 text-primary'
              : 'text-muted hover:text-default'
          "
          @click="timeline.setType('all')"
        >
          All files
        </button>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <!-- Loading -->
      <div
        v-if="timeline.loading.value && timeline.entries.value.length === 0"
        class="px-4 py-12 text-center text-sm text-muted"
      >
        <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin inline-block" />
        <p class="mt-2">Loading timeline…</p>
      </div>

      <!-- Error -->
      <div v-else-if="timeline.error.value" class="px-4 py-12 text-center text-sm text-error">
        {{ timeline.error.value }}
      </div>

      <!-- Empty -->
      <div
        v-else-if="timeline.entries.value.length === 0"
        class="px-4 py-16 text-center text-sm text-muted"
      >
        <AppIcon name="i-lucide-clock" class="size-8 mx-auto mb-3 opacity-40" />
        <p>Nothing to show yet.</p>
        <p class="mt-1 text-xs">
          Capture dates are extracted in the background — check back shortly after uploading.
        </p>
      </div>

      <!-- Justified gallery -->
      <div v-else class="px-4 pb-6">
        <JustifiedGallery :groups="galleryGroups" @select="openPreview" />

        <!-- Infinite-scroll sentinel + load-more fallback -->
        <div ref="sentinel" class="h-px" />
        <div v-if="timeline.loadingMore.value" class="py-4 text-center text-sm text-muted">
          <AppIcon name="i-lucide-loader-2" class="size-4 animate-spin inline-block" />
        </div>
        <div v-else-if="timeline.nextCursor.value" class="py-4 text-center">
          <button
            type="button"
            class="text-sm text-primary hover:underline"
            @click="timeline.loadMore()"
          >
            Load more
          </button>
        </div>
      </div>
    </div>

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId"
      :files="timeline.entries.value"
      @navigate="previewFile = $event"
      @update:file="handleFileUpdate"
    />
  </div>
</template>
