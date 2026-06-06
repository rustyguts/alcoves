<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import "vidstack/player/styles/default/theme.css";
import "vidstack/player/styles/default/layouts/video.css";
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "~/api";
import type { LibraryFile, PlaybackSource } from "~~/shared/types/api";

const props = defineProps<{
  file: LibraryFile;
  libraryId: string;
  active?: boolean;
}>();

const emit = defineEmits<{
  "update:currentTime": [value: number];
  "update:duration": [value: number];
  "update:paused": [value: boolean];
}>();

type VidstackPlayer = HTMLElement & {
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  play?: () => Promise<void>;
  pause?: () => void;
  subscribe?: (
    cb: (state: { currentTime: number; duration: number; paused: boolean }) => void,
  ) => () => void;
};

const playerReady = ref(false);
const playbackSources = ref<PlaybackSource[]>([]);
const selectedPlaybackSourceId = ref<string | null>(null);
const playerEl = ref<HTMLElement | null>(null);

const currentTime = ref(0);
const duration = ref(props.file.duration ?? 0);
const paused = ref(true);

// Aspect ratio of the frame box. Vidstack's default video layout draws
// chrome (controls, gradients) inside the player surface, so we letterbox
// the actual <video> via object-contain inside a 16:9 frame.
const FRAME_ASPECT = 16 / 9;

// Outer container fills its grid cell; we then size an inner frame to the
// largest 16:9 box that fits inside that cell. Pure-CSS approaches with
// aspect-ratio + max-w/max-h end up either clipping or breaking the ratio
// when the cell is short and wide vs tall and narrow, so we measure with
// ResizeObserver and write px dimensions back to an inline style.
const wrapperEl = ref<HTMLElement | null>(null);
const frameWidth = ref(0);
const frameHeight = ref(0);

function recomputeFrame() {
  const el = wrapperEl.value;
  if (!el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return;
  if (w / h > FRAME_ASPECT) {
    // cell wider than 16:9 → height-bound, derive width
    frameHeight.value = h;
    frameWidth.value = h * FRAME_ASPECT;
  } else {
    // cell taller-or-equal to 16:9 → width-bound, derive height
    frameWidth.value = w;
    frameHeight.value = w / FRAME_ASPECT;
  }
}

let resizeObserver: ResizeObserver | null = null;

const fileUrl = computed(() =>
  apiUrl(`/api/libraries/${props.libraryId}/files/${props.file.id}?inline=true`),
);

const selectedPlaybackSource = computed(() => {
  if (!selectedPlaybackSourceId.value) return null;
  return playbackSources.value.find((s) => s.id === selectedPlaybackSourceId.value) ?? null;
});

const videoSrc = computed(() => {
  const fromSource = selectedPlaybackSource.value?.streamUrl;
  if (fromSource) return apiUrl(fromSource);
  return fileUrl.value;
});

const mediaSrc = computed(
  () =>
    ({
      src: videoSrc.value,
      type: selectedPlaybackSource.value?.mimeType ?? props.file.mimeType,
    }) as unknown as import("vidstack").PlayerSrc,
);

async function refreshPlaybackSources() {
  try {
    const response = await api.files.playbackSources(props.libraryId, props.file.id);
    playbackSources.value = response.sources ?? [];
    selectedPlaybackSourceId.value = response.defaultSourceId ?? null;
  } catch {
    playbackSources.value = [];
    selectedPlaybackSourceId.value = null;
  }
}

onMounted(async () => {
  if (import.meta.client && wrapperEl.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(recomputeFrame);
    resizeObserver.observe(wrapperEl.value);
    recomputeFrame();
  }
  await import("vidstack/player");
  await import("vidstack/player/layouts");
  await import("vidstack/player/ui");
  playerReady.value = true;
  await refreshPlaybackSources();
});

let unsubs: Array<() => void> = [];

function attachPlayerListeners(el: VidstackPlayer) {
  if (typeof el.subscribe === "function") {
    const unsub = el.subscribe(({ currentTime: ct, duration: d, paused: p }) => {
      if (typeof ct === "number" && ct !== currentTime.value) {
        currentTime.value = ct;
        emit("update:currentTime", ct);
      }
      if (typeof d === "number" && Number.isFinite(d) && d > 0 && d !== duration.value) {
        duration.value = d;
        emit("update:duration", d);
      }
      if (typeof p === "boolean" && p !== paused.value) {
        paused.value = p;
        emit("update:paused", p);
      }
    });
    unsubs = [unsub];
    return;
  }

  const onTime = () => {
    const ct = el.currentTime;
    if (typeof ct === "number") {
      currentTime.value = ct;
      emit("update:currentTime", ct);
    }
  };
  const onDur = () => {
    const d = el.duration;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) {
      duration.value = d;
      emit("update:duration", d);
    }
  };
  const onPlay = () => {
    paused.value = false;
    emit("update:paused", false);
  };
  const onPause = () => {
    paused.value = true;
    emit("update:paused", true);
  };

  el.addEventListener("time-update", onTime);
  el.addEventListener("duration-change", onDur);
  el.addEventListener("loaded-metadata", onDur);
  el.addEventListener("play", onPlay);
  el.addEventListener("pause", onPause);

  unsubs = [
    () => el.removeEventListener("time-update", onTime),
    () => el.removeEventListener("duration-change", onDur),
    () => el.removeEventListener("loaded-metadata", onDur),
    () => el.removeEventListener("play", onPlay),
    () => el.removeEventListener("pause", onPause),
  ];
}

watch(
  [playerEl, playerReady],
  ([el, ready]) => {
    if (unsubs.length) {
      unsubs.forEach((fn) => fn());
      unsubs = [];
    }
    if (el && ready) attachPlayerListeners(el as VidstackPlayer);
  },
  { immediate: true },
);

watch(
  () => props.file.duration,
  (d) => {
    if (typeof d === "number" && Number.isFinite(d) && d > 0 && d !== duration.value) {
      duration.value = d;
      emit("update:duration", d);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  unsubs.forEach((fn) => fn());
  unsubs = [];
  resizeObserver?.disconnect();
  resizeObserver = null;
});

function seek(seconds: number) {
  const el = playerEl.value as VidstackPlayer | null;
  if (el) el.currentTime = Math.max(0, seconds);
}

function togglePlay() {
  const el = playerEl.value as VidstackPlayer | null;
  if (!el) return;
  if (el.paused) void el.play?.();
  else el.pause?.();
}

defineExpose({ seek, togglePlay, currentTime, duration, paused });
</script>

<template>
  <!--
    Outer wrapper fills its grid cell. ResizeObserver measures the
    cell's content box on every layout change and writes pixel
    dimensions onto the inner frame so the largest possible 16:9 box
    fits without clipping. The video itself uses object-contain inside
    that frame so vertical / square / odd sources letterbox instead of
    being cropped or stretched.
  -->
  <div ref="wrapperEl" class="relative w-full flex items-center justify-center">
    <div
      class="relative bg-black rounded-lg overflow-hidden flex items-center justify-center"
      :style="{
        width: frameWidth ? `${frameWidth}px` : '100%',
        height: frameHeight ? `${frameHeight}px` : 'auto',
      }"
    >
      <media-player
        v-if="playerReady"
        ref="playerEl"
        class="player h-full w-full"
        :src="mediaSrc"
        :title="file.name"
        crossorigin="use-credentials"
        playsinline
      >
        <media-provider />
        <media-video-layout />
      </media-player>
      <div v-else class="flex items-center justify-center py-16">
        <UIcon :name="ICONS.loading" class="size-6 animate-spin text-white/60" />
      </div>
      <div
        v-show="active"
        class="pointer-events-none absolute inset-0 rounded-lg border-4 border-primary z-10 transition-opacity"
      />
    </div>
  </div>
</template>

<style scoped>
.player {
  --media-border-radius: 0;
}
/* Force the inner <video> to letterbox inside the frame regardless of
 * source aspect ratio. Vidstack's default fits to the player element,
 * which is already 16:9, but a vertical source would stretch without
 * an explicit object-fit override. */
.player :deep(video) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
