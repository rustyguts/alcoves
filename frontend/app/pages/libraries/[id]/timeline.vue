<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { useLibraryTimeline } from "~/composables/useLibraryTimeline";
import type { LibraryFile } from "~~/shared/types/api";
import { getMimeIcon } from "~/utils/mime-icons";
import AlcovesImage from "~/components/AlcovesImage.vue";
import AppIcon from "~/components/AppIcon.vue";
import FilePreview from "~/components/FilePreview.vue";

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

function openPreview(file: LibraryFile) {
  previewFile.value = file;
  previewOpen.value = true;
}

function handleFileUpdate(updated: LibraryFile) {
  if (previewFile.value?.id === updated.id) {
    previewFile.value = { ...previewFile.value, ...updated };
  }
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
      { rootMargin: "600px" },
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

      <!-- Grouped timeline -->
      <div v-else class="px-4 py-4">
        <section v-for="group in timeline.groups.value" :key="group.key" class="mb-6">
          <h3
            class="sticky top-0 z-10 -mx-4 px-4 py-1.5 bg-default/80 backdrop-blur text-sm font-semibold text-default"
          >
            {{ group.label }}
          </h3>
          <div class="mt-2 grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
            <button
              v-for="file in group.files"
              :key="file.id"
              type="button"
              class="group relative aspect-square overflow-hidden rounded-md bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              :title="file.name"
              @click="openPreview(file)"
            >
              <AlcovesImage
                v-if="thumbId(file)"
                :library-id="libraryId"
                :file-id="thumbId(file)!"
                :width="240"
                :height="240"
                format="webp"
                :quality="70"
                class="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <span v-else class="flex h-full w-full items-center justify-center text-dimmed">
                <AppIcon :name="getMimeIcon(file.mimeType)" class="size-8" />
              </span>

              <!-- Video play badge -->
              <span
                v-if="isVideo(file)"
                class="absolute bottom-1 right-1 rounded bg-black/60 p-0.5 text-white"
              >
                <AppIcon name="i-lucide-play" class="size-3" />
              </span>
            </button>
          </div>
        </section>

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
