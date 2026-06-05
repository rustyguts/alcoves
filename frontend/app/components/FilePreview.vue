<script setup lang="ts">
import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/audio.css";
import "vidstack/player/styles/default/layouts/video.css";

import type { LibraryFile, PlaybackSource, PlaybackSourcesResponse } from "~~/shared/types/api";
import { proxyQueryString, resolveVariant } from "~~/shared/image-variants";
import { getMimeIcon } from "~/utils/mime-icons";
import { apiFetch } from "~/utils/api-fetch";
import { api } from "~/api";
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

const fileUrl = computed(() =>
  apiUrl(`/api/libraries/${props.libraryId}/files/${props.file.id}?inline=true`),
);

const playbackSources = ref<PlaybackSource[]>([]);
const selectedPlaybackSourceId = ref<string | null>(null);
const generatingProxy = ref(false);

const proxyStatus = ref<string | null>(props.file.proxyStatus ?? null);
const proxyProgress = ref<number | null>(props.file.proxyProgress ?? null);
const proxyEtaSeconds = ref<number | null>(props.file.proxyEtaSeconds ?? null);

const videoProxyProcessing = computed(
  () => previewType.value === "video" && ["queued", "processing"].includes(proxyStatus.value ?? ""),
);

const videoProxyProgressPercent = computed(() => {
  const raw = proxyProgress.value;
  if (raw === null || Number.isNaN(raw)) return 0;
  return Math.min(100, Math.max(0, Math.round(raw)));
});

const videoProxyEtaLabel = computed(() => {
  const eta = proxyEtaSeconds.value;
  if (eta === null || eta <= 0) return null;

  const hours = Math.floor(eta / 3600);
  const minutes = Math.floor((eta % 3600) / 60);
  const seconds = eta % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
});

const selectedPlaybackSource = computed(() => {
  if (!selectedPlaybackSourceId.value) return null;
  return (
    playbackSources.value.find((source) => source.id === selectedPlaybackSourceId.value) ?? null
  );
});

const videoSrc = computed(() => {
  if (props.file.mimeType.startsWith("video/")) {
    const source = selectedPlaybackSource.value;
    if (source) {
      return source.streamUrl;
    }
  }
  return fileUrl.value;
});

const mediaSrc = computed(
  () =>
    ({
      src: videoSrc.value,
      type: selectedPlaybackSource.value?.mimeType ?? props.file.mimeType,
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

async function refreshProxyState() {
  if (!open.value || !props.file.mimeType.startsWith("video/")) return;

  try {
    const latest = await api.files.get(props.libraryId, props.file.id);
    proxyStatus.value = latest.proxyStatus ?? null;
    proxyProgress.value = latest.proxyProgress ?? null;
    proxyEtaSeconds.value = latest.proxyEtaSeconds ?? null;
  } catch {}
}

async function refreshPlaybackSources() {
  if (!open.value || !props.file.mimeType.startsWith("video/")) return;
  try {
    const response = await api.files.playbackSources(props.libraryId, props.file.id);
    playbackSources.value = response.sources ?? [];
    const hasCurrentSelection = playbackSources.value.some(
      (source) => source.id === selectedPlaybackSourceId.value,
    );
    selectedPlaybackSourceId.value = hasCurrentSelection
      ? selectedPlaybackSourceId.value
      : response.defaultSourceId;
  } catch {
    playbackSources.value = [];
    selectedPlaybackSourceId.value = null;
  }
}

async function generateProxy() {
  if (!props.file.mimeType.startsWith("video/")) return;
  generatingProxy.value = true;
  try {
    await api.files.generateProxy(props.libraryId, props.file.id);
    await refreshProxyState();
  } finally {
    generatingProxy.value = false;
  }
}

let proxyPollTimer: ReturnType<typeof setInterval> | null = null;

function stopProxyPolling() {
  if (!proxyPollTimer) return;
  clearInterval(proxyPollTimer);
  proxyPollTimer = null;
}

function startProxyPolling() {
  if (proxyPollTimer) return;
  proxyPollTimer = setInterval(() => {
    void refreshProxyState();
  }, 2000);
}

function downloadFile() {
  const link = document.createElement("a");
  link.href = apiUrl(`/api/libraries/${props.libraryId}/files/${props.file.id}?inline=true`);
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
    proxyStatus.value = props.file.proxyStatus ?? null;
    proxyProgress.value = props.file.proxyProgress ?? null;
    proxyEtaSeconds.value = props.file.proxyEtaSeconds ?? null;
    imageLoaded.value = false;
    loadedImageWidth.value = null;
    loadedImageHeight.value = null;
    playbackSources.value = [];
    selectedPlaybackSourceId.value = null;
  },
);

// History management for mouse-back-button support
const popCount = ref(0);

function pushPreviewHistory() {
  history.pushState({ filePreview: true }, "");
  popCount.value++;
}

function closePreview() {
  if (popCount.value > 0) {
    history.back();
  } else {
    open.value = false;
  }
}

function onPopstate() {
  if (popCount.value > 0) {
    popCount.value--;
    if (open.value) {
      open.value = false;
    }
  }
}

watch(
  [open, () => props.file.id, () => props.file.mimeType],
  ([isOpen, _fileID, mimeType], [wasOpen]) => {
    if (isOpen && !wasOpen) {
      pushPreviewHistory();
    }
    if (!isOpen || !mimeType.startsWith("video/")) {
      stopProxyPolling();
      return;
    }
    void refreshProxyState();
    void refreshPlaybackSources();
  },
  { immediate: true },
);

watch(proxyStatus, (status) => {
  if (status === "ready") {
    void refreshPlaybackSources();
  }
});

watch(
  videoProxyProcessing,
  (processing) => {
    if (processing && open.value) {
      startProxyPolling();
      return;
    }
    if (!processing) {
      stopProxyPolling();
    }
  },
  { immediate: true },
);

// Preload adjacent images. Uses the shared "preview" variant so the lightbox
// requests exactly the cache key the pre-warm job generated.
function buildPreviewUrl(file: LibraryFile): string {
  const query = proxyQueryString(resolveVariant("preview", file.width, file.height));
  return apiUrl(`/api/files/proxy/${props.libraryId}/${file.id}?${query}`);
}

const previewImageUrl = computed(() => buildPreviewUrl(props.file));

// Hold refs to preloaded Image objects so GC cannot cancel in-flight requests.
const preloadedImages = ref<HTMLImageElement[]>([]);

watch(
  [() => props.file.id, open],
  () => {
    if (!open.value) {
      preloadedImages.value = [];
      return;
    }
    preloadedImages.value = [previousFile.value, nextFile.value]
      .filter((f): f is LibraryFile => f !== null && f.mimeType.startsWith("image/"))
      .map((f) => {
        const img = new Image();
        img.crossOrigin = "use-credentials";
        img.src = buildPreviewUrl(f);
        return img;
      });
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
    closePreview();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("popstate", onPopstate);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("popstate", onPopstate);
  stopProxyPolling();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm"
      @click.self="closePreview"
    >
      <!-- Media content: fills the entire viewport -->
      <div
        v-if="previewType === 'video'"
        class="w-full h-full flex items-center justify-center px-16"
      >
        <media-player
          v-if="playerReady && open"
          class="player w-full max-w-5xl"
          :src="mediaSrc"
          :title="file.name"
          crossorigin="use-credentials"
          playsinline
          autoplay
        >
          <media-provider />
          <media-video-layout />
        </media-player>
        <div v-else class="flex items-center justify-center">
          <AppIcon name="i-lineicons-spinner-solid" class="size-5 animate-spin text-white/60" />
        </div>
      </div>

      <div
        v-else-if="previewType === 'audio'"
        class="w-full h-full flex items-center justify-center px-16"
      >
        <media-player
          v-if="playerReady && open"
          class="player w-full max-w-2xl"
          :src="mediaSrc"
          :title="file.name"
          crossorigin="use-credentials"
          playsinline
        >
          <media-provider />
          <media-audio-layout />
        </media-player>
        <div v-else class="flex items-center justify-center">
          <AppIcon name="i-lineicons-spinner-solid" class="size-5 animate-spin text-white/60" />
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
          crossorigin="use-credentials"
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
        <iframe :src="fileUrl" class="w-full h-full rounded-lg border-0" />
      </div>

      <div
        v-else-if="previewType === 'text'"
        class="w-full h-full flex items-center justify-center overflow-auto p-16"
      >
        <pre
          v-if="textContent !== null"
          class="p-4 bg-neutral-900/80 rounded-lg border border-white/20 text-sm text-white whitespace-pre-wrap max-w-4xl w-full self-start"
          >{{ textContent }}</pre
        >
        <div v-else class="flex items-center justify-center">
          <AppIcon name="i-lineicons-spinner-solid" class="size-5 animate-spin text-white/60" />
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
            class="inline-flex items-center justify-center size-10 rounded-full text-white/80 hover:text-white hover:bg-white/20 transition-colors"
            @click="closePreview"
          >
            <AppIcon name="i-lineicons-x" class="size-5" />
          </button>
          <span class="text-white text-sm font-medium truncate">{{ file.name }}</span>
          <div v-if="previewType === 'video'" class="flex items-center gap-2">
            <UButton
              color="primary"
              variant="soft"
              size="xs"
              icon="i-lineicons-camera-movie-1"
              :loading="generatingProxy"
              :disabled="generatingProxy"
              @click="generateProxy"
            >
              Create Proxy
            </UButton>
            <select
              v-if="playbackSources.length > 0"
              v-model="selectedPlaybackSourceId"
              class="rounded-md border border-white/25 bg-black/40 px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary/60"
            >
              <option
                v-for="source in playbackSources"
                :key="source.id"
                :value="source.id"
                class="bg-neutral-900 text-white"
              >
                {{ source.kind === "proxy" ? "Proxy" : "Source" }} - {{ source.name }}
              </option>
            </select>
          </div>
        </div>
        <button
          class="inline-flex items-center justify-center size-10 rounded-full text-white/80 hover:text-white hover:bg-white/20 shrink-0 pointer-events-auto transition-colors"
          @click="downloadFile"
        >
          <AppIcon name="i-lineicons-download" class="size-5" />
        </button>
      </div>

      <div
        v-if="videoProxyProcessing"
        class="absolute left-1/2 top-14 z-20 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-white/15 bg-black/65 p-3 backdrop-blur-sm"
      >
        <div class="mb-2 flex items-center justify-between text-xs text-white/80">
          <span>Preparing video preview</span>
          <span class="font-semibold">{{ videoProxyProgressPercent }}%</span>
        </div>
        <UProgress
          class="w-full"
          :model-value="videoProxyProgressPercent"
          :max="100"
          color="primary"
          size="sm"
        />
        <p v-if="videoProxyEtaLabel" class="mt-1 text-xs text-white/70">
          ETA {{ videoProxyEtaLabel }}
        </p>
      </div>

      <!-- Overlay: previous button -->
      <button
        v-if="hasPrevious"
        class="absolute left-4 top-1/2 z-20 -translate-y-1/2 inline-flex items-center justify-center size-10 rounded-full text-white bg-black/40 hover:bg-black/70 transition-colors"
        @click="goToPrevious"
      >
        <AppIcon name="i-lineicons-chevron-left" class="size-5" />
      </button>

      <!-- Overlay: next button -->
      <button
        v-if="hasNext"
        class="absolute right-4 top-1/2 z-20 -translate-y-1/2 inline-flex items-center justify-center size-10 rounded-full text-white bg-black/40 hover:bg-black/70 transition-colors"
        @click="goToNext"
      >
        <AppIcon name="i-lineicons-chevron-right" class="size-5" />
      </button>
    </div>
  </Teleport>
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
