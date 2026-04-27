<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue";
import type { Moment } from "~~/shared/types/api";

const props = defineProps<{
  duration: number;
  currentTime: number;
  moments: Moment[];
  selectedId?: string | null;
}>();

const emit = defineEmits<{
  seek: [seconds: number];
  "select-moment": [momentId: string];
  "save-pending": [changes: Array<{ id: string; startSeconds: number; endSeconds: number }>];
  "create-moment": [];
  "open-shortcuts": [];
}>();

const scrollEl = ref<HTMLElement | null>(null);
const trackEl = ref<HTMLElement | null>(null);
const rulerEl = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
const zoom = ref(1);

const MIN_ZOOM = 1;
const MAX_ZOOM = 50;
const ZOOM_STEP = 1.5;
const SCROLL_STEP_FRACTION = 0.25;
const MIN_MOMENT_SECONDS = 0.05;

interface Pending {
  startSeconds: number;
  endSeconds: number;
}

const pendingChanges = ref<Record<string, Pending>>({});
const savingPending = ref(false);

const hasPending = computed(() => Object.keys(pendingChanges.value).length > 0);

function effective(m: Moment): Pending {
  return (
    pendingChanges.value[m.id] ?? {
      startSeconds: m.startSeconds,
      endSeconds: m.endSeconds,
    }
  );
}

function isDirty(id: string): boolean {
  return id in pendingChanges.value;
}

interface MomentStatus {
  kind: "not_processed" | "processing" | "processed" | "failed";
  label: string;
  progress: number | null;
}

function momentStatus(m: Moment): MomentStatus {
  if (m.exportStatus === "ready" && m.exportedVersion === m.exportVersion) {
    return { kind: "processed", label: "Processed", progress: null };
  }
  if (m.exportStatus === "failed") {
    return { kind: "failed", label: "Failed", progress: null };
  }
  if (m.exportStatus === "queued" || m.exportStatus === "processing") {
    return {
      kind: "processing",
      label:
        m.exportProgress != null ? `Processing ${Math.round(m.exportProgress)}%` : "Processing",
      progress: m.exportProgress,
    };
  }
  return { kind: "not_processed", label: "Not processed", progress: null };
}

function shouldShowStatusPill(m: Moment): boolean {
  const eff = effective(m);
  return (eff.endSeconds - eff.startSeconds) * pxPerSec.value > 120;
}

const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 6; // radius 6 in viewBox 16

function progressDashArray(progress: number | null): string {
  const p = Math.max(0, Math.min(100, progress ?? 0));
  const filled = (p / 100) * CIRCLE_CIRCUMFERENCE;
  return `${filled} ${CIRCLE_CIRCUMFERENCE}`;
}

// When server sends new moment values (after save), drop matching pending entries.
const FLOAT_EPSILON = 0.001;
watch(
  () => props.moments,
  (list) => {
    const next = { ...pendingChanges.value };
    let changed = false;
    for (const m of list) {
      const p = next[m.id];
      if (
        p &&
        Math.abs(p.startSeconds - m.startSeconds) < FLOAT_EPSILON &&
        Math.abs(p.endSeconds - m.endSeconds) < FLOAT_EPSILON
      ) {
        delete next[m.id];
        changed = true;
      }
    }
    if (changed) pendingChanges.value = next;
  },
  { deep: true },
);

const innerWidth = computed(() => Math.max(0, containerWidth.value * zoom.value));
const pxPerSec = computed(() => (props.duration > 0 ? innerWidth.value / props.duration : 0));

const playheadLeftPx = computed(() => props.currentTime * pxPerSec.value);

function momentStylePx(m: Moment) {
  const eff = effective(m);
  const left = eff.startSeconds * pxPerSec.value;
  const width = Math.max(2, (eff.endSeconds - eff.startSeconds) * pxPerSec.value);
  return { left: `${left}px`, width: `${width}px` };
}

type DragMode = "move" | "start" | "end";
interface DragState {
  mode: DragMode;
  momentId: string;
  startClientX: number;
  initial: Pending;
  moved: boolean;
}
let drag: DragState | null = null;

function beginDrag(mode: DragMode, m: Moment, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  emit("select-moment", m.id);
  drag = {
    mode,
    momentId: m.id,
    startClientX: event.clientX,
    initial: effective(m),
    moved: false,
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

function onDragMove(event: MouseEvent) {
  if (!drag || pxPerSec.value === 0) return;
  const dxPx = event.clientX - drag.startClientX;
  const dxSec = dxPx / pxPerSec.value;
  if (Math.abs(dxPx) > 2) drag.moved = true;

  const { initial, mode, momentId } = drag;
  let start = initial.startSeconds;
  let end = initial.endSeconds;
  const dur = props.duration;

  if (mode === "move") {
    const len = end - start;
    start = Math.max(0, Math.min(dur - len, initial.startSeconds + dxSec));
    end = start + len;
  } else if (mode === "start") {
    start = Math.max(0, Math.min(end - MIN_MOMENT_SECONDS, initial.startSeconds + dxSec));
  } else {
    end = Math.min(dur, Math.max(start + MIN_MOMENT_SECONDS, initial.endSeconds + dxSec));
  }

  pendingChanges.value = {
    ...pendingChanges.value,
    [momentId]: { startSeconds: start, endSeconds: end },
  };
}

function onDragEnd() {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  // Suppress click from bubbling to track (prevents seek) after drag.
  if (drag?.moved) {
    const suppress = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      window.removeEventListener("click", suppress, true);
    };
    window.addEventListener("click", suppress, true);
  }
  drag = null;
}

async function savePending() {
  const changes = Object.entries(pendingChanges.value).map(([id, p]) => ({
    id,
    startSeconds: p.startSeconds,
    endSeconds: p.endSeconds,
  }));
  if (changes.length === 0) return;
  savingPending.value = true;
  pendingChanges.value = {};
  try {
    emit("save-pending", changes);
  } finally {
    savingPending.value = false;
  }
}

function onTrackClick(event: MouseEvent) {
  const el = trackEl.value;
  if (!el || !props.duration) return;
  const rect = el.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const seconds = (x / innerWidth.value) * props.duration;
  emit("seek", Math.max(0, Math.min(props.duration, seconds)));
}

function onRulerClick(event: MouseEvent) {
  const el = rulerEl.value;
  if (!el || !props.duration) return;
  const rect = el.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const seconds = (x / innerWidth.value) * props.duration;
  emit("seek", Math.max(0, Math.min(props.duration, seconds)));
}

function zoomAt(factor: number) {
  const sc = scrollEl.value;
  const prevPxPerSec = pxPerSec.value;
  const playheadScreenX = playheadLeftPx.value - (sc?.scrollLeft ?? 0);

  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.value * factor));
  if (next === zoom.value) return;
  zoom.value = next;

  void nextTick(() => {
    const scEl = scrollEl.value;
    if (!scEl) return;
    if (prevPxPerSec === 0) {
      scEl.scrollLeft = 0;
      return;
    }
    const newPlayheadX = props.currentTime * pxPerSec.value;
    scEl.scrollLeft = newPlayheadX - playheadScreenX;
  });
}

function zoomIn() {
  zoomAt(ZOOM_STEP);
}

function zoomOut() {
  zoomAt(1 / ZOOM_STEP);
}

function scrollToPlayhead() {
  const sc = scrollEl.value;
  if (!sc) return;
  sc.scrollTo({
    left: playheadLeftPx.value - sc.clientWidth / 2,
    behavior: "smooth",
  });
}

function scrollStep(direction: -1 | 1) {
  const sc = scrollEl.value;
  if (!sc) return;
  const step = sc.clientWidth * SCROLL_STEP_FRACTION * direction;
  sc.scrollBy({ left: step, behavior: "smooth" });
}

function onWheel(e: WheelEvent) {
  const sc = scrollEl.value;
  if (!sc) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    return;
  }
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (delta === 0) return;
  e.preventDefault();
  sc.scrollLeft += delta;
}

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target && /input|textarea|select/i.test(target.tagName)) return;
  if (target?.isContentEditable) return;
  switch (e.key.toLowerCase()) {
    case "z":
      zoomIn();
      e.preventDefault();
      break;
    case "x":
      zoomOut();
      e.preventDefault();
      break;
    case "a":
      scrollStep(-1);
      e.preventDefault();
      break;
    case "d":
      scrollStep(1);
      e.preventDefault();
      break;
    case "c":
      scrollToPlayhead();
      e.preventDefault();
      break;
  }
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!scrollEl.value) return;
  containerWidth.value = scrollEl.value.clientWidth;
  resizeObserver = new ResizeObserver(() => {
    if (scrollEl.value) containerWidth.value = scrollEl.value.clientWidth;
  });
  resizeObserver.observe(scrollEl.value);
  scrollEl.value.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  scrollEl.value?.removeEventListener("wheel", onWheel);
  window.removeEventListener("keydown", onKeydown);
});

// Auto-follow playhead while zoomed in: keep it inside viewport
watch([() => props.currentTime, pxPerSec, containerWidth], () => {
  const sc = scrollEl.value;
  if (!sc || zoom.value <= 1) return;
  const screenX = playheadLeftPx.value - sc.scrollLeft;
  const margin = 40;
  if (screenX < margin || screenX > sc.clientWidth - margin) {
    sc.scrollLeft = playheadLeftPx.value - sc.clientWidth / 2;
  }
});

// Pick a "nice" tick interval so tick labels are readable regardless of zoom.
const NICE_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MINOR_TICKS_PER_MAJOR = 5;

const tickInterval = computed(() => {
  if (pxPerSec.value === 0) return 60;
  const targetPxBetweenTicks = 80;
  const rawSec = targetPxBetweenTicks / pxPerSec.value;
  return NICE_STEPS.find((s) => s >= rawSec) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
});

interface Tick {
  seconds: number;
  leftPx: number;
  major: boolean;
  label: string | null;
}

const ticks = computed<Tick[]>(() => {
  const out: Tick[] = [];
  if (!props.duration || pxPerSec.value === 0) return out;
  const major = tickInterval.value;
  const minor = major / MINOR_TICKS_PER_MAJOR;
  const end = props.duration;
  // Step in minor increments, label only major boundaries.
  const epsilon = minor / 100;
  for (let s = 0; s <= end + epsilon; s += minor) {
    const isMajor = Math.abs(s % major) < epsilon || Math.abs((s % major) - major) < epsilon;
    out.push({
      seconds: s,
      leftPx: s * pxPerSec.value,
      major: isMajor,
      label: isMajor ? formatTimeLabel(s, major) : null,
    });
  }
  return out;
});

function formatTimeLabel(seconds: number, step: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalMs = Math.round(seconds * 1000);
  const showFractions = step < 1;
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (showFractions) {
    const tenths = Math.round(ms / 100);
    return `${base}.${tenths}`;
  }
  return base;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  return formatTimeLabel(seconds, 1);
}
</script>

<template>
  <div class="select-none">
    <div class="flex items-center gap-2 mb-1.5">
      <span class="text-xs text-muted tabular-nums">
        {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
      </span>
      <span class="text-xs text-muted tabular-nums"> {{ (zoom * 100).toFixed(0) }}% </span>
      <div class="flex-1" />
      <UTooltip text="Keyboard shortcuts">
        <UButton
          color="neutral"
          variant="subtle"
          size="xs"
          icon="i-lucide-keyboard"
          square
          @click="emit('open-shortcuts')"
        />
      </UTooltip>
      <UButton color="primary" size="xs" icon="i-lucide-plus" @click="emit('create-moment')">
        New moment
      </UButton>
      <UButton
        :color="hasPending ? 'warning' : 'neutral'"
        :variant="hasPending ? 'solid' : 'subtle'"
        size="xs"
        icon="i-lucide-save"
        :disabled="!hasPending || savingPending"
        :loading="savingPending"
        @click="savePending"
      >
        Save changes
      </UButton>
    </div>

    <div ref="scrollEl" class="timeline-scroll overflow-x-scroll overflow-y-hidden">
      <div class="relative" :style="{ width: `${innerWidth}px` }">
        <!-- Ruler (click to scrub) -->
        <div
          ref="rulerEl"
          class="relative h-5 border-b border-default/70 cursor-pointer hover:bg-elevated/40"
          @click="onRulerClick"
        >
          <div
            v-for="t in ticks"
            :key="t.seconds"
            class="absolute top-0 bottom-0 pointer-events-none"
            :class="t.major ? 'w-px bg-default' : 'w-px bg-default/40'"
            :style="{ left: `${t.leftPx}px` }"
          >
            <span
              v-if="t.label"
              class="absolute top-0 left-1 text-[10px] text-muted tabular-nums whitespace-nowrap"
            >
              {{ t.label }}
            </span>
          </div>
          <!-- Ruler playhead indicator -->
          <div
            class="absolute top-0 bottom-0 w-0.5 bg-blue-500 pointer-events-none"
            :style="{ left: `${playheadLeftPx}px` }"
          />
        </div>

        <!-- Track -->
        <div
          ref="trackEl"
          class="relative h-28 rounded-b-lg bg-accented dark:bg-elevated/70 ring ring-default cursor-pointer overflow-hidden"
          role="slider"
          :aria-valuemin="0"
          :aria-valuemax="duration"
          :aria-valuenow="currentTime"
          @click="onTrackClick"
        >
          <!-- Moment bars -->
          <div
            v-for="m in moments"
            :key="m.id"
            class="group absolute top-1 bottom-1 rounded-md border transition-colors cursor-grab active:cursor-grabbing"
            :class="[
              isDirty(m.id)
                ? 'bg-warning/40 hover:bg-warning/55 border-warning'
                : 'bg-primary/35 hover:bg-primary/55 border-primary/60',
              m.id === selectedId
                ? isDirty(m.id)
                  ? 'ring-2 ring-warning'
                  : 'ring-2 ring-primary border-primary'
                : '',
            ]"
            :style="momentStylePx(m)"
            :title="`${m.name || 'Untitled'} (${effective(m).startSeconds.toFixed(2)}s – ${effective(m).endSeconds.toFixed(2)}s)`"
            @mousedown="beginDrag('move', m, $event)"
            @click.stop="emit('select-moment', m.id)"
          >
            <!-- Status pill -->
            <div
              v-if="shouldShowStatusPill(m)"
              class="absolute top-1 left-3 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 text-[10px] text-white/95 font-medium pointer-events-none"
            >
              <template v-if="momentStatus(m).kind === 'processing'">
                <svg
                  v-if="momentStatus(m).progress != null"
                  viewBox="0 0 16 16"
                  class="size-3.5"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    stroke-opacity="0.25"
                    stroke-width="2"
                  />
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    :stroke-dasharray="progressDashArray(momentStatus(m).progress)"
                    transform="rotate(-90 8 8)"
                  />
                </svg>
                <UIcon v-else name="i-lucide-loader-2" class="size-3 animate-spin" />
              </template>
              <UIcon
                v-else-if="momentStatus(m).kind === 'processed'"
                name="i-lucide-check-circle-2"
                class="size-3 text-success-400"
              />
              <UIcon
                v-else-if="momentStatus(m).kind === 'failed'"
                name="i-lucide-alert-circle"
                class="size-3 text-error-400"
              />
              <UIcon v-else name="i-lucide-circle-dashed" class="size-3 text-white/70" />
              <span>{{ momentStatus(m).label }}</span>
            </div>

            <!-- Moment name -->
            <span
              class="absolute inset-x-3 bottom-1 text-[10px] truncate text-white/90 font-medium pointer-events-none"
            >
              {{ m.name || "Untitled" }}
              <span v-if="isDirty(m.id)" class="ml-1 text-warning-200">●</span>
            </span>

            <!-- Left handle -->
            <div
              class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-center rounded-l-md"
              :class="
                isDirty(m.id) ? 'bg-warning/80 hover:bg-warning' : 'bg-primary/80 hover:bg-primary'
              "
              @mousedown.stop="beginDrag('start', m, $event)"
              @click.stop
            >
              <UIcon name="i-lucide-grip-vertical" class="size-3 text-white/90" />
            </div>

            <!-- Right handle -->
            <div
              class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-center rounded-r-md"
              :class="
                isDirty(m.id) ? 'bg-warning/80 hover:bg-warning' : 'bg-primary/80 hover:bg-primary'
              "
              @mousedown.stop="beginDrag('end', m, $event)"
              @click.stop
            >
              <UIcon name="i-lucide-grip-vertical" class="size-3 text-white/90" />
            </div>
          </div>

          <!-- Playhead -->
          <div
            class="absolute top-0 bottom-0 w-0.5 bg-blue-500 shadow-lg pointer-events-none"
            :style="{ left: `${playheadLeftPx}px` }"
          >
            <div class="absolute -top-1 -left-1 size-2 rounded-full bg-blue-500" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.timeline-scroll::-webkit-scrollbar {
  display: none;
}
</style>
