<script setup lang="ts">
/**
 * Timeline date scrubber — a slim rail down the right edge of the timeline
 * (Google-Photos style). Maps the whole library's date span to the rail height,
 * newest at the top. It renders:
 *   - year labels at each year boundary (click to jump),
 *   - per-month density "blips" whose length scales with that month's count, so
 *     you can see where photos cluster,
 *   - a draggable handle synced to the gallery's scroll position, with a date
 *     bubble showing the period under the handle.
 *
 * Positions are laid out by *cumulative count* (so a busy month occupies more
 * rail than a sparse one), which tracks the gallery's scroll height. The parent
 * owns the scroll: dragging/clicking emits `scrub` with a 0..1 fraction and the
 * parent scrolls proportionally; the parent feeds the live scroll position back
 * via `progress` so the handle follows normal scrolling too.
 */
import { computed, ref } from "vue";
import type { TimelineBucket } from "~/composables/useLibraryTimeline";

const props = defineProps<{
  /** Per-month density buckets, newest-first. */
  buckets: TimelineBucket[];
  /** Current scroll fraction 0..1 (0 = top = newest), for handle sync. */
  progress: number;
}>();

const emit = defineEmits<{ scrub: [fraction: number] }>();

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthName(m: number): string {
  return MONTHS[m - 1] ?? String(m);
}

const total = computed(() => props.buckets.reduce((s, b) => s + b.count, 0));
const maxCount = computed(() => props.buckets.reduce((m, b) => Math.max(m, b.count), 0));

interface Mark {
  bucket: TimelineBucket;
  /** Fraction (0..1) of the rail where this bucket begins. */
  startFrac: number;
  /** Fraction of the rail at the bucket's midpoint (blip anchor). */
  midFrac: number;
  /** 0..1 relative to the busiest month — drives blip length. */
  density: number;
  /** First (newest) bucket of its year — gets a year label. */
  yearStart: boolean;
}

const marks = computed<Mark[]>(() => {
  const t = total.value || 1;
  const mx = maxCount.value || 1;
  let cum = 0;
  let prevYear = Number.NaN;
  return props.buckets.map((b) => {
    const startFrac = cum / t;
    cum += b.count;
    const endFrac = cum / t;
    const yearStart = b.year !== prevYear;
    prevYear = b.year;
    return {
      bucket: b,
      startFrac,
      midFrac: (startFrac + endFrac) / 2,
      density: b.count / mx,
      yearStart,
    };
  });
});

const yearMarks = computed(() => marks.value.filter((m) => m.yearStart));

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Period label at a rail fraction, by cumulative count (matches `marks`).
function labelAt(frac: number): string {
  const t = total.value || 1;
  const target = frac * t;
  let cum = 0;
  for (const b of props.buckets) {
    cum += b.count;
    if (target <= cum) return `${monthName(b.month)} ${b.year}`;
  }
  const last = props.buckets[props.buckets.length - 1];
  return last ? `${monthName(last.month)} ${last.year}` : "";
}

const trackEl = ref<HTMLElement | null>(null);
const dragging = ref(false);
const dragFrac = ref(0);
const hoverFrac = ref<number | null>(null);

// Where the handle sits: the live drag fraction while dragging (instant
// feedback), otherwise the scroll-driven progress from the parent.
const handleFrac = computed(() => clamp01(dragging.value ? dragFrac.value : props.progress));

const bubbleFrac = computed(() => (dragging.value ? dragFrac.value : (hoverFrac.value ?? 0)));
const bubbleVisible = computed(() => dragging.value || hoverFrac.value !== null);
const bubbleLabel = computed(() => labelAt(bubbleFrac.value));

function fracFromEvent(e: PointerEvent): number {
  const el = trackEl.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  return clamp01((e.clientY - rect.top) / rect.height);
}

function onPointerDown(e: PointerEvent) {
  dragging.value = true;
  const f = fracFromEvent(e);
  dragFrac.value = f;
  trackEl.value?.setPointerCapture?.(e.pointerId);
  emit("scrub", f);
  e.preventDefault();
}

function onPointerMove(e: PointerEvent) {
  const f = fracFromEvent(e);
  if (dragging.value) {
    dragFrac.value = f;
    emit("scrub", f);
  } else {
    hoverFrac.value = f;
  }
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  trackEl.value?.releasePointerCapture?.(e.pointerId);
}

function onPointerLeave() {
  if (!dragging.value) hoverFrac.value = null;
}

function nudge(delta: number) {
  emit("scrub", clamp01(props.progress + delta));
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case "ArrowUp":
      nudge(-0.05);
      break;
    case "ArrowDown":
      nudge(0.05);
      break;
    case "PageUp":
      nudge(-0.2);
      break;
    case "PageDown":
      nudge(0.2);
      break;
    case "Home":
      emit("scrub", 0);
      break;
    case "End":
      emit("scrub", 1);
      break;
    default:
      return;
  }
  e.preventDefault();
}
</script>

<template>
  <aside class="relative flex w-14 shrink-0 select-none py-3" aria-label="Jump to date">
    <div
      ref="trackEl"
      class="relative flex-1 cursor-ns-resize touch-none border-l border-default"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
    >
      <!-- Per-month density blips: longer = more photos that month. -->
      <span
        v-for="(m, i) in marks"
        :key="`blip-${i}`"
        class="pointer-events-none absolute right-2 h-[3px] -translate-y-1/2 rounded-full bg-current text-dimmed"
        :style="{
          top: `${m.midFrac * 100}%`,
          width: `${4 + m.density * 18}px`,
          opacity: 0.5 + m.density * 0.5,
        }"
        aria-hidden="true"
      />

      <!-- Year labels at each year boundary (click to jump). -->
      <button
        v-for="(m, i) in yearMarks"
        :key="`yr-${i}`"
        type="button"
        class="absolute right-1 -translate-y-1/2 cursor-pointer rounded px-1 text-[11px] font-semibold tabular-nums text-muted transition-colors hover:text-default"
        :style="{ top: `${m.startFrac * 100}%` }"
        @click="emit('scrub', m.startFrac)"
      >
        {{ m.bucket.year }}
      </button>

      <!-- Draggable handle (keyboard-accessible slider). -->
      <div
        role="slider"
        tabindex="0"
        aria-label="Scrub timeline by date"
        aria-orientation="vertical"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="Math.round(handleFrac * 100)"
        :aria-valuetext="labelAt(handleFrac)"
        class="pointer-events-none absolute inset-x-0 -translate-y-1/2 focus:outline-none"
        :style="{ top: `${handleFrac * 100}%` }"
        @keydown="onKeydown"
      >
        <span class="block h-0.5 w-full rounded-full bg-primary" />
      </div>

      <!-- Date bubble shown while hovering / dragging the rail. -->
      <span
        v-if="bubbleVisible && bubbleLabel"
        class="pointer-events-none absolute right-full mr-2 -translate-y-1/2 whitespace-nowrap rounded bg-inverted px-2 py-1 text-xs font-medium tabular-nums text-inverted shadow ring-1 ring-default"
        :style="{ top: `${clamp01(bubbleFrac) * 100}%` }"
      >
        {{ bubbleLabel }}
      </span>
    </div>
  </aside>
</template>
