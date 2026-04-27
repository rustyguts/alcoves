<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import type { Moment } from "~~/shared/types/api";

const props = defineProps<{
  moments: Moment[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [momentId: string];
}>();

const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 300;
const STORAGE_KEY = "alcoves.editor.sidebarWidth";

const width = ref(DEFAULT_WIDTH);

onMounted(() => {
  if (!import.meta.client) return;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const n = parseInt(saved, 10);
    if (Number.isFinite(n)) width.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  }
});

let dragStartX = 0;
let dragStartWidth = 0;
const isResizing = ref(false);

function onResizeDown(event: MouseEvent) {
  event.preventDefault();
  dragStartX = event.clientX;
  dragStartWidth = width.value;
  isResizing.value = true;
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", onResizeUp);
}

function onResizeMove(event: MouseEvent) {
  const dx = dragStartX - event.clientX;
  width.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth + dx));
}

function onResizeUp() {
  isResizing.value = false;
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeUp);
  if (import.meta.client) {
    localStorage.setItem(STORAGE_KEY, String(Math.round(width.value)));
  }
}

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onResizeMove);
  window.removeEventListener("mouseup", onResizeUp);
});

function formatDuration(m: Moment): string {
  return `${(m.endSeconds - m.startSeconds).toFixed(2)}s`;
}

function formatRange(m: Moment): string {
  return `${m.startSeconds.toFixed(1)}s – ${m.endSeconds.toFixed(1)}s`;
}

function statusBadge(m: Moment): {
  color: "primary" | "success" | "error" | "warning" | "neutral";
  label: string;
} {
  switch (m.exportStatus) {
    case "queued":
      return { color: "warning", label: "queued" };
    case "processing":
      return {
        color: "warning",
        label: m.exportProgress != null ? `${m.exportProgress}%` : "processing",
      };
    case "ready":
      return { color: "success", label: "ready" };
    case "failed":
      return { color: "error", label: "failed" };
    default:
      return { color: "neutral", label: "—" };
  }
}

const sortedMoments = computed(() =>
  [...props.moments].sort((a, b) => a.startSeconds - b.startSeconds),
);
</script>

<template>
  <div
    class="relative shrink-0 h-full border-l border-default bg-muted flex flex-col min-h-0"
    :style="{ width: `${width}px` }"
    :class="isResizing ? 'select-none' : ''"
  >
    <div
      class="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-ew-resize hover:bg-primary/40 z-10"
      :class="isResizing ? 'bg-primary/60' : ''"
      @mousedown="onResizeDown"
    />

    <div class="flex flex-col p-3 gap-2 overflow-y-auto flex-1 min-h-0">
      <div class="flex items-center justify-between">
        <p class="text-sm font-semibold">Moments</p>
        <span class="text-[11px] text-muted tabular-nums">{{ moments.length }}</span>
      </div>
      <div
        v-if="moments.length === 0"
        class="rounded-lg border border-dashed border-default p-4 text-center text-xs text-muted"
      >
        No moments yet. Press <kbd class="px-1 bg-elevated rounded">M</kbd> to create one.
      </div>
      <ul v-else class="flex flex-col gap-1">
        <li v-for="m in sortedMoments" :key="m.id">
          <UCard
            variant="subtle"
            role="button"
            tabindex="0"
            :class="[
              'cursor-pointer transition-colors outline-none',
              m.id === selectedId
                ? 'ring-2 ring-primary bg-primary/10'
                : 'hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary',
            ]"
            :ui="{ body: 'p-2 sm:p-2' }"
            @click="emit('select', m.id)"
            @keydown.enter.prevent="emit('select', m.id)"
            @keydown.space.prevent="emit('select', m.id)"
          >
            <div class="flex flex-col gap-0.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium truncate">
                  {{ m.name || "Untitled" }}
                </span>
                <UBadge :color="statusBadge(m).color" variant="subtle" size="xs" class="shrink-0">
                  {{ statusBadge(m).label }}
                </UBadge>
              </div>
              <div class="flex items-center gap-2 text-[10px] text-muted tabular-nums">
                <span>{{ formatRange(m) }}</span>
                <span>·</span>
                <span>{{ formatDuration(m) }}</span>
              </div>
            </div>
          </UCard>
        </li>
      </ul>
    </div>
  </div>
</template>
