<script setup lang="ts">
import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/audio.css";
import "vidstack/player/styles/default/layouts/video.css";

import type { LibraryFile } from "~~/server/utils/types";
import { getMimeIcon, formatFileSize, formatDate } from "~/utils/mime-icons";

const props = defineProps<{
  file: LibraryFile;
  libraryId: string;
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
</script>

<template>
  <UModal
    v-model:open="open"
    :title="file.name"
    :ui="{ content: previewType === 'unsupported' ? '' : 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <!-- Video -->
        <div v-if="previewType === 'video'" class="w-full">
          <media-player
            v-if="playerReady"
            class="player"
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
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
          </div>
        </div>

        <!-- Audio -->
        <div v-else-if="previewType === 'audio'" class="w-full">
          <media-player
            v-if="playerReady"
            class="player"
            :src="mediaSrc"
            :title="file.name"
            crossorigin
            playsinline
          >
            <media-provider />
            <media-audio-layout />
          </media-player>
          <div v-else class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
          </div>
        </div>

        <!-- Image -->
        <div v-else-if="previewType === 'image'" class="flex justify-center">
          <img
            :src="fileUrl"
            :alt="file.name"
            class="max-h-[70vh] max-w-full object-contain rounded"
          />
        </div>

        <!-- PDF -->
        <div v-else-if="previewType === 'pdf'" class="w-full">
          <iframe :src="fileUrl" class="w-full h-[70vh] rounded border border-default" />
        </div>

        <!-- Text -->
        <div v-else-if="previewType === 'text'" class="w-full">
          <pre
            v-if="textContent !== null"
            class="p-4 bg-elevated rounded border border-default text-sm overflow-auto max-h-[70vh] whitespace-pre-wrap"
            >{{ textContent }}</pre
          >
          <div v-else class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
          </div>
        </div>

        <!-- Unsupported -->
        <div v-else class="flex flex-col items-center gap-4 py-8">
          <UIcon :name="getMimeIcon(file.mimeType)" class="size-16 text-muted" />
          <p class="text-sm text-muted">
            Preview not available for this file type ({{ file.mimeType }})
          </p>
        </div>

        <!-- File info -->
        <div
          class="flex items-center justify-between text-xs text-muted pt-2 border-t border-default"
        >
          <span>{{ formatFileSize(file.size) }}</span>
          <span>{{ formatDate(file.createdAt) }}</span>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton label="Close" color="neutral" variant="outline" @click="open = false" />
        <UButton label="Download" icon="i-lucide-download" @click="downloadFile" />
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
