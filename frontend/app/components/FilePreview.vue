<script setup lang="ts">
import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/audio.css";
import "vidstack/player/styles/default/layouts/video.css";

import type { LibraryFile } from "~~/shared/types/api";
import { getMimeIcon } from "~/utils/mime-icons";
import { apiFetch } from "~/utils/api-fetch";
import AppIcon from "~/components/AppIcon.vue";

const props = defineProps<{
  file: LibraryFile;
  libraryId: string;
  files: LibraryFile[];
}>();

const emit = defineEmits<{
  navigate: [file: LibraryFile];
}>();

const open = defineModel<boolean>("open", { default: false });

const fileUrl = computed(
  () => `/api/libraries/${props.libraryId}/files/${props.file.id}?inline=true`,
);

const videoSrc = computed(() => {
  if (props.file.mimeType.startsWith("video/") && props.file.proxyStatus === "ready") {
    return `/api/libraries/${props.libraryId}/files/${props.file.id}/proxy`;
  }
  return fileUrl.value;
});

const mediaSrc = computed(
  () =>
    ({
      src: videoSrc.value,
      type: props.file.proxyStatus === "ready" ? "video/mp4" : props.file.mimeType,
    }) as unknown as import("vidstack").PlayerSrc,
);

const previewType = computed(() => {
  const mime = props.file.mimeType;
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "unsupported";
});

const loadedImageWidth = ref<number | null>(null);
const loadedImageHeight = ref<number | null>(null);

const imageWidth = computed(() => props.file.width ?? loadedImageWidth.value);
const imageHeight = computed(() => props.file.height ?? loadedImageHeight.value);

// Keep low-resolution images near their natural display size in the preview.
const shouldConstrainImageSize = computed(() => {
  const w = imageWidth.value;
  const h = imageHeight.value;
  if (!w || !h) return false;

  const megapixels = (w * h) / 1_000_000;
  const longestEdge = Math.max(w, h);

  return megapixels < 1 || longestEdge < 1280;
});

const imageSizeStyle = computed(() => {
  const w = imageWidth.value;
  const h = imageHeight.value;
  if (!shouldConstrainImageSize.value || !w || !h) return undefined;

  return {
    maxHeight: `${h}px`,
    maxWidth: `${w}px`,
  };
});

// Register vidstack custom elements client-side only
const playerReady = ref(false);

onMounted(async () => {
  await import("vidstack/player");
  await import("vidstack/player/layouts");
  await import("vidstack/player/ui");
  playerReady.value = true;
});

const textContent = ref<string | null>(null);

watch(
  () => [open.value, previewType.value],
  async ([isOpen, type]) => {
    if (isOpen && type === "text") {
      try {
        textContent.value = await apiFetch<string>(fileUrl.value, { responseType: "text" });
      } catch {
        textContent.value = null;
      }
    }
  },
);

function downloadFile() {
  const link = document.createElement("a");
  link.href = `/api/libraries/${props.libraryId}/files/${props.file.id}`;
  link.download = "";
  link.click();
}

// Navigation
const currentIndex = computed(() => props.files.findIndex((f) => f.id === props.file.id));

const hasPrevious = computed(() => currentIndex.value > 0);
const hasNext = computed(
  () => currentIndex.value >= 0 && currentIndex.value < props.files.length - 1,
);

const previousFile = computed(() =>
  hasPrevious.value ? props.files[currentIndex.value - 1]! : null,
);
const nextFile = computed(() => (hasNext.value ? props.files[currentIndex.value + 1]! : null));

function goToPrevious() {
  if (hasPrevious.value) {
    imageLoaded.value = false;
    emit("navigate", props.files[currentIndex.value - 1]!);
  }
}

function goToNext() {
  if (hasNext.value) {
    imageLoaded.value = false;
    emit("navigate", props.files[currentIndex.value + 1]!);
  }
}

// Image fade-in state
const imageLoaded = ref(false);

function onImageLoad(event: Event) {
  const target = event.target;
  if (target instanceof HTMLImageElement) {
    loadedImageWidth.value = target.naturalWidth;
    loadedImageHeight.value = target.naturalHeight;
  }

  imageLoaded.value = true;
}

// Reset loaded state when file changes
watch(
  () => props.file.id,
  () => {
    imageLoaded.value = false;
    loadedImageWidth.value = null;
    loadedImageHeight.value = null;
  },
);

// Preload adjacent images
function buildPreviewUrl(file: LibraryFile): string {
  const w = file.width && file.width < 1920 ? file.width : 1920;
  const h = file.height && file.height < 1080 ? file.height : 1080;
  const params = new URLSearchParams([
    ["format", "jpeg"],
    ["height", String(h)],
    ["quality", "90"],
    ["width", String(w)],
  ]);
  return `/api/files/proxy/${props.libraryId}/${file.id}?${params}`;
}

const previewImageUrl = computed(() => buildPreviewUrl(props.file));

watch(
  [() => props.file.id, open],
  () => {
    if (!open.value) return;
    for (const adjacent of [previousFile.value, nextFile.value]) {
      if (adjacent && adjacent.mimeType.startsWith("image/")) {
        const img = new Image();
        img.src = buildPreviewUrl(adjacent);
      }
    }
  },
  { immediate: true },
);

// Keyboard navigation
function handleKeydown(event: KeyboardEvent) {
  if (!open.value) return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goToPrevious();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    goToNext();
  } else if (event.key === "Escape") {
    event.preventDefault();
    open.value = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': open }">
    <div
      class="modal-box max-w-none w-screen h-screen rounded-none bg-black/95 backdrop-blur-sm p-0 flex items-center justify-center"
    >
      <!-- Media content: fills the entire viewport -->
      <div
        v-if="previewType === 'video'"
        class="w-full h-full flex items-center justify-center px-16"
      >
        <media-player
          v-if="playerReady"
          class="player w-full max-w-5xl"
          :src="mediaSrc"
          :title="file.name"
          crossorigin
          playsinline
          autoplay
        >
          <media-provider />
          <media-video-layout />
        </media-player>
        <div v-else class="flex items-center justify-center">
          <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white/60" />
        </div>
      </div>

      <div
        v-else-if="previewType === 'audio'"
        class="w-full h-full flex items-center justify-center px-16"
      >
        <media-player
          v-if="playerReady"
          class="player w-full max-w-2xl"
          :src="mediaSrc"
          :title="file.name"
          crossorigin
          playsinline
        >
          <media-provider />
          <media-audio-layout />
        </media-player>
        <div v-else class="flex items-center justify-center">
          <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white/60" />
        </div>
      </div>

      <div
        v-else-if="previewType === 'image'"
        class="w-full h-full flex items-center justify-center"
      >
        <img
          :src="previewImageUrl"
          :alt="file.name"
          decoding="async"
          class="block transition-opacity duration-100"
          :class="[
            'max-h-full max-w-full object-contain',
            imageLoaded ? 'opacity-100' : 'opacity-0',
          ]"
          :style="imageSizeStyle"
          @load="onImageLoad"
        />
      </div>

      <div v-else-if="previewType === 'pdf'" class="w-full h-full p-16">
        <iframe :src="fileUrl" class="w-full h-full rounded border-0" />
      </div>

      <div
        v-else-if="previewType === 'text'"
        class="w-full h-full flex items-center justify-center overflow-auto p-16"
      >
        <pre
          v-if="textContent !== null"
          class="p-4 bg-neutral-900/80 rounded border border-white/20 text-sm text-white whitespace-pre-wrap max-w-4xl w-full self-start"
          >{{ textContent }}</pre
        >
        <div v-else class="flex items-center justify-center">
          <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white/60" />
        </div>
      </div>

      <div v-else class="flex flex-col items-center gap-4">
        <AppIcon :name="getMimeIcon(file.mimeType)" class="size-24 text-white/40" />
        <p class="text-sm text-white/60">
          Preview not available for this file type ({{ file.mimeType }})
        </p>
      </div>

      <!-- Overlay: top bar with close, filename, download -->
      <div
        class="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent pointer-events-none z-20"
      >
        <div class="flex items-center gap-3 min-w-0 pointer-events-auto">
          <button
            class="btn btn-circle btn-ghost text-white hover:bg-white/20"
            @click="open = false"
          >
            <AppIcon name="i-lucide-x" class="size-5" />
          </button>
          <span class="text-white text-sm font-medium truncate">{{ file.name }}</span>
        </div>
        <button
          class="btn btn-circle btn-ghost text-white hover:bg-white/20 shrink-0 pointer-events-auto"
          @click="downloadFile"
        >
          <AppIcon name="i-lucide-download" class="size-5" />
        </button>
      </div>

      <!-- Overlay: previous button -->
      <button
        v-if="hasPrevious"
        class="btn btn-circle btn-ghost absolute left-4 top-1/2 -translate-y-1/2 z-20 text-white bg-black/40 hover:bg-black/70"
        @click="goToPrevious"
      >
        <AppIcon name="i-lucide-chevron-left" class="size-5" />
      </button>

      <!-- Overlay: next button -->
      <button
        v-if="hasNext"
        class="btn btn-circle btn-ghost absolute right-4 top-1/2 -translate-y-1/2 z-20 text-white bg-black/40 hover:bg-black/70"
        @click="goToNext"
      >
        <AppIcon name="i-lucide-chevron-right" class="size-5" />
      </button>
    </div>
    <form method="dialog" class="modal-backdrop" @click="open = false">
      <button>close</button>
    </form>
  </dialog>
</template>

<style>
.player[data-view-type="video"] {
  aspect-ratio: 16 / 9;
}

.player {
  --video-brand: #f5f5f5;
  --video-focus-ring-color: #4e9cf6;
  --video-border-radius: 6px;
  --audio-brand: #f5f5f5;
  --audio-focus-ring-color: #4e9cf6;
  --audio-border-radius: 6px;
}
</style>
