<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useLibraryTimeline, type TimelineGroup } from "~/composables/useLibraryTimeline";
import type { LibraryFile } from "~~/shared/types/api";
import type { GalleryGroup, GalleryItem } from "~/utils/gallery-types";
import { formatDuration } from "~/utils/format-duration";
import AppIcon from "~/components/AppIcon.vue";
import FilePreview from "~/components/FilePreview.vue";
import JustifiedGallery from "~/components/JustifiedGallery.vue";
import TimelineScrubber from "~/components/TimelineScrubber.vue";

definePageMeta({ layout: "library" });

const route = useRoute();
const libraryId = computed(() => route.params.id as string);

const timeline = useLibraryTimeline(libraryId);
// Timeline is photos & videos only — there is no file/all toggle here.
timeline.typeFilter.value = "media";

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

// Map the composable's day groups into gallery groups. The gallery runs in
// `continuous` mode, so days flow across shared rows to maximise space; each
// day's first tile carries a compact date marker instead of a full-width band.
const galleryGroups = computed<GalleryGroup<LibraryFile>[]>(() =>
  timeline.groups.value.map((g: TimelineGroup) => {
    const d = dayDate(g.key);
    return {
      key: g.key,
      sectionLabel: null,
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
          durationLabel: isVideo(f) ? formatDuration(f.duration) : null,
          sourceWidth: f.width,
          sourceHeight: f.height,
          raw: f,
        }),
      ),
    };
  }),
);

// Distinct years (newest-first) for the custom scrubber rail. Groups arrive
// sorted newest-first by day, so years are monotonic and the first group seen
// for a year is its newest day — the anchor we scroll to.
const years = computed<{ year: number; key: string }[]>(() => {
  const out: { year: number; key: string }[] = [];
  let seen = Number.NaN;
  for (const g of timeline.groups.value) {
    const y = Number(g.key.split("-")[0]);
    if (y !== seen) {
      out.push({ year: y, key: g.key });
      seen = y;
    }
  }
  return out;
});

// `Y-M-D` (UTC) key → Date. Month is the 0-based value emitted by the composable.
function dayDate(key: string): Date {
  const [y, m, day] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, m ?? 0, day ?? 1));
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

const scrollEl = ref<HTMLElement | null>(null);

// Jump the scroll viewport to a year's newest day. The gallery tags the first
// tile of each day with `data-group-key`, so we scroll that anchor into view.
function scrollToYear(key: string) {
  const el = scrollEl.value?.querySelector<HTMLElement>(`[data-group-key="${key}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      { root: scrollEl.value, rootMargin: "800px" },
    );
    observer.observe(sentinel.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <div class="flex h-full min-h-0">
    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <!-- Loading -->
      <div
        v-if="timeline.loading.value && timeline.entries.value.length === 0"
        class="px-4 py-12 text-center text-sm text-muted"
      >
        <AppIcon :name="ICONS.loading" class="size-5 animate-spin inline-block" />
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
        <AppIcon :name="ICONS.timeline" class="size-8 mx-auto mb-3 opacity-40" />
        <p>Nothing to show yet.</p>
        <p class="mt-1 text-xs">
          Capture dates are extracted in the background — check back shortly after uploading.
        </p>
      </div>

      <!-- Justified gallery -->
      <div v-else class="px-2 pt-2 pb-6 sm:px-3">
        <JustifiedGallery continuous :groups="galleryGroups" @select="openPreview" />

        <!-- Infinite-scroll sentinel + load-more fallback -->
        <div ref="sentinel" class="h-px" />
        <div v-if="timeline.loadingMore.value" class="py-4 text-center text-sm text-muted">
          <AppIcon :name="ICONS.loading" class="size-4 animate-spin inline-block" />
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

    <TimelineScrubber v-if="years.length > 1" :years="years" @jump="scrollToYear" />

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
