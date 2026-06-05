<script setup lang="ts">
import { computed, ref } from "vue";
import type { AudioDetection } from "~~/shared/types/api";

const props = defineProps<{
  detections: AudioDetection[];
  duration: number;
}>();

const emit = defineEmits<{
  seek: [seconds: number];
}>();

interface LabelBucket {
  label: string;
  classIndex: number;
  bestScore: number;
  count: number;
  windows: AudioDetection[];
}

const buckets = computed<LabelBucket[]>(() => {
  const byLabel = new Map<string, LabelBucket>();
  for (const d of props.detections) {
    const b = byLabel.get(d.label);
    if (b) {
      b.count++;
      b.windows.push(d);
      if (d.score > b.bestScore) b.bestScore = d.score;
    } else {
      byLabel.set(d.label, {
        label: d.label,
        classIndex: d.classIndex,
        bestScore: d.score,
        count: 1,
        windows: [d],
      });
    }
  }
  return [...byLabel.values()].sort((a, b) => b.bestScore - a.bestScore);
});

const expanded = ref<Set<string>>(new Set());
const collapsed = ref(true);

function toggleExpand(label: string) {
  const next = new Set(expanded.value);
  if (next.has(label)) next.delete(label);
  else next.add(label);
  expanded.value = next;
}

function scoreColor(score: number): "success" | "primary" | "warning" | "neutral" {
  if (score >= 0.7) return "success";
  if (score >= 0.4) return "primary";
  if (score >= 0.2) return "warning";
  return "neutral";
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

function barStyle(window: AudioDetection) {
  if (props.duration <= 0) return { left: "0%", width: "100%" };
  const left = Math.max(0, (window.startSeconds / props.duration) * 100);
  const width = Math.max(0.5, ((window.endSeconds - window.startSeconds) / props.duration) * 100);
  return { left: `${left}%`, width: `${width}%` };
}
</script>

<template>
  <div v-if="detections.length > 0" class="rounded-md bg-elevated/50">
    <button
      type="button"
      class="flex items-center justify-between gap-2 w-full px-3 py-2 border-b border-default text-left hover:bg-elevated/40 transition-colors"
      :class="collapsed ? 'border-b-0' : ''"
      @click="collapsed = !collapsed"
    >
      <div class="flex items-center gap-2">
        <UIcon
          :name="collapsed ? 'i-lineicons-chevron-right' : 'i-lineicons-chevron-down'"
          class="size-3.5 text-muted shrink-0"
        />
        <UIcon name="i-lineicons-pulse" class="size-4 text-primary" />
        <p class="text-sm font-semibold">Audio events</p>
        <UBadge color="neutral" variant="subtle" size="xs">{{ buckets.length }} labels</UBadge>
      </div>
      <p v-if="!collapsed" class="text-[11px] text-muted">Click a bar to jump to that moment</p>
    </button>

    <ul v-if="!collapsed" class="flex flex-col divide-y divide-default">
      <li v-for="b in buckets" :key="b.label" class="px-3 py-2">
        <button
          type="button"
          class="flex items-center justify-between gap-3 w-full text-left"
          @click="toggleExpand(b.label)"
        >
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <UIcon
              :name="expanded.has(b.label) ? 'i-lineicons-chevron-down' : 'i-lineicons-chevron-right'"
              class="size-3.5 text-muted shrink-0"
            />
            <span class="text-sm font-medium truncate">{{ b.label }}</span>
            <UBadge :color="scoreColor(b.bestScore)" variant="soft" size="xs" class="shrink-0">
              {{ (b.bestScore * 100).toFixed(0) }}%
            </UBadge>
            <span class="text-[11px] text-muted tabular-nums shrink-0"> {{ b.count }}× </span>
          </div>
        </button>

        <!-- Timeline strip -->
        <div class="relative mt-1.5 h-2 rounded-full bg-elevated/70 overflow-hidden">
          <button
            v-for="w in b.windows"
            :key="w.id"
            type="button"
            class="absolute top-0 bottom-0 rounded-sm transition-opacity hover:opacity-90"
            :class="{
              'bg-success': w.score >= 0.7,
              'bg-primary': w.score < 0.7 && w.score >= 0.4,
              'bg-warning': w.score < 0.4 && w.score >= 0.2,
              'bg-neutral-500': w.score < 0.2,
            }"
            :style="[barStyle(w), { opacity: 0.4 + 0.6 * w.score }]"
            :title="`${w.label} · ${(w.score * 100).toFixed(0)}% at ${formatTime(w.startSeconds)}`"
            @click.stop="emit('seek', w.startSeconds)"
          />
        </div>

        <ul v-if="expanded.has(b.label)" class="mt-2 flex flex-wrap gap-1 pl-5">
          <li v-for="w in b.windows" :key="w.id">
            <button
              type="button"
              class="flex items-center gap-1 px-2 py-0.5 rounded-md border border-default text-[11px] hover:border-primary hover:bg-elevated tabular-nums"
              @click="emit('seek', w.startSeconds)"
            >
              <UIcon name="i-lineicons-play" class="size-2.5" />
              {{ formatTime(w.startSeconds) }}
              <span class="text-muted"> · {{ (w.score * 100).toFixed(0) }}% </span>
            </button>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
