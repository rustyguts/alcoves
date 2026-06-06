<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import type { LibraryFile } from "~~/shared/types/api";
import type { JobStatusButton } from "~/utils/job-status-button";

defineProps<{
  file: LibraryFile | null | undefined;
  transcribing: boolean;
  transcribeButton: JobStatusButton;
  audioDetecting: boolean;
  audioDetectButton: JobStatusButton;
  canDetectAudio: boolean;
  waveformGenerating: boolean;
  waveformButton: JobStatusButton;
}>();

const emit = defineEmits<{
  back: [];
  transcribe: [];
  "audio-detect": [];
  waveform: [];
}>();

function isPlayable(mimeType: string | undefined | null): boolean {
  return !!mimeType && (mimeType.startsWith("video/") || mimeType.startsWith("audio/"));
}
</script>

<template>
  <div class="flex items-center gap-3 w-full">
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      :icon="ICONS.back"
      @click="emit('back')"
    >
      Back
    </UButton>
    <div class="min-w-0 flex-1">
      <p class="text-lg font-semibold truncate">{{ file?.name ?? "Loading…" }}</p>
    </div>
    <UButton
      v-if="file && isPlayable(file.mimeType)"
      :color="transcribeButton.color"
      :variant="file?.transcribeStatus === 'failed' ? 'solid' : 'soft'"
      size="sm"
      :icon="ICONS.transcript"
      :loading="transcribeButton.loading || transcribing"
      :disabled="transcribeButton.disabled || transcribing"
      @click="emit('transcribe')"
    >
      {{ transcribeButton.label }}
    </UButton>
    <UButton
      v-if="canDetectAudio"
      :color="audioDetectButton.color"
      :variant="file?.audioDetectStatus === 'failed' ? 'solid' : 'soft'"
      size="sm"
      :icon="ICONS.audioDetect"
      :loading="audioDetectButton.loading || audioDetecting"
      :disabled="audioDetectButton.disabled || audioDetecting"
      @click="emit('audio-detect')"
    >
      {{ audioDetectButton.label }}
    </UButton>
    <UButton
      v-if="file && isPlayable(file.mimeType)"
      :color="waveformButton.color"
      :variant="file?.waveformStatus === 'failed' ? 'solid' : 'soft'"
      size="sm"
      :icon="ICONS.waveform"
      :loading="waveformButton.loading || waveformGenerating"
      :disabled="waveformButton.disabled || waveformGenerating"
      @click="emit('waveform')"
    >
      {{ waveformButton.label }}
    </UButton>
  </div>
</template>
