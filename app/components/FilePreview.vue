<script setup lang="ts">
import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/audio.css";
import "vidstack/player/styles/default/layouts/video.css";

import type { LibraryFile } from "~~/server/utils/types";
import { getMimeIcon } from "~/utils/mime-icons";

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

const mediaSrc = computed(() => ({
  src: fileUrl.value,
  type: props.file.mimeType,
}));

const previewType = computed(() => {
  const mime = props.file.mimeType;
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "unsupported";
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
        textContent.value = await $fetch<string>(fileUrl.value, { responseType: "text" });
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

function goToPrevious() {
  if (hasPrevious.value) {
    emit("navigate", props.files[currentIndex.value - 1]!);
  }
}

function goToNext() {
  if (hasNext.value) {
    emit("navigate", props.files[currentIndex.value + 1]!);
  }
}

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
  <UModal
    v-model:open="open"
    fullscreen
    :close="false"
    :ui="{
      content: 'bg-black/95 backdrop-blur-sm',
      header: 'bg-transparent border-b-0',
      body: 'flex items-center justify-center p-0 grow',
    }"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-3 min-w-0">
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="lg"
            class="text-white hover:bg-white/20"
            @click="open = false"
          />
          <span class="text-white text-sm font-medium truncate">{{ file.name }}</span>
        </div>
        <UButton
          icon="i-lucide-download"
          color="neutral"
          variant="ghost"
          size="lg"
          class="text-white hover:bg-white/20 shrink-0"
          @click="downloadFile"
        />
      </div>
    </template>

    <template #body>
      <div class="relative flex items-center justify-center w-full h-full">
        <!-- Previous -->
        <UButton
          v-if="hasPrevious"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="lg"
          class="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full"
          @click="goToPrevious"
        />

        <!-- Next -->
        <UButton
          v-if="hasNext"
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          size="lg"
          class="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-white bg-black/50 hover:bg-black/70 rounded-full"
          @click="goToNext"
        />

        <!-- Video -->
        <div v-if="previewType === 'video'" class="w-full max-w-5xl px-16">
          <media-player
            v-if="playerReady"
            class="player w-full"
            :src="mediaSrc"
            :title="file.name"
            crossorigin
            playsinline
            autoplay
          >
            <media-provider />
            <media-video-layout />
          </media-player>
          <div v-else class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white/60" />
          </div>
        </div>

        <!-- Audio -->
        <div v-else-if="previewType === 'audio'" class="w-full max-w-2xl px-16">
          <media-player
            v-if="playerReady"
            class="player w-full"
            :src="mediaSrc"
            :title="file.name"
            crossorigin
            playsinline
          >
            <media-provider />
            <media-audio-layout />
          </media-player>
          <div v-else class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white/60" />
          </div>
        </div>

        <!-- Image -->
        <div
          v-else-if="previewType === 'image'"
          class="flex items-center justify-center w-full h-full px-16"
        >
          <AlcovesImage
            :library-id="libraryId"
            :file-id="file.id"
            :alt="file.name"
            :width="1200"
            class="max-h-full max-w-full object-contain block"
          />
        </div>

        <!-- PDF -->
        <div v-else-if="previewType === 'pdf'" class="w-full h-full max-w-5xl px-16">
          <iframe :src="fileUrl" class="w-full h-full rounded border-0" />
        </div>

        <!-- Text -->
        <div
          v-else-if="previewType === 'text'"
          class="w-full max-w-4xl max-h-full overflow-auto px-16"
        >
          <pre
            v-if="textContent !== null"
            class="p-4 bg-neutral-900/80 rounded border border-white/20 text-sm text-white whitespace-pre-wrap"
          >{{ textContent }}</pre>
          <div v-else class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white/60" />
          </div>
        </div>

        <!-- Unsupported -->
        <div v-else class="flex flex-col items-center gap-4 py-8">
          <UIcon :name="getMimeIcon(file.mimeType)" class="size-24 text-white/40" />
          <p class="text-sm text-white/60">
            Preview not available for this file type ({{ file.mimeType }})
          </p>
        </div>
      </div>
    </template>
  </UModal>
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
