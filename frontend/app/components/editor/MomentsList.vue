<script setup lang="ts">
import { computed } from "vue";
import type { Moment } from "~~/shared/types/api";

const props = defineProps<{
  moments: Moment[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [momentId: string];
}>();

const sortedMoments = computed(() =>
  [...props.moments].sort((a, b) => a.startSeconds - b.startSeconds),
);

function formatDuration(m: Moment): string {
  return `${(m.endSeconds - m.startSeconds).toFixed(2)}s`;
}

function formatRange(m: Moment): string {
  return `${m.startSeconds.toFixed(1)}s – ${m.endSeconds.toFixed(1)}s`;
}

type BadgeColor = "primary" | "success" | "error" | "warning" | "neutral";
function statusBadge(m: Moment): { color: BadgeColor; label: string } {
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
</script>

<template>
  <UCard
    :ui="{
      header: 'px-3 py-2',
      body: 'p-3 overflow-y-auto max-h-[60vh] lg:max-h-[400px]',
    }"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold">Moments</p>
        <span class="text-[11px] text-muted tabular-nums">{{ moments.length }}</span>
      </div>
    </template>

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
              <span class="text-xs font-medium truncate">{{ m.name || "Untitled" }}</span>
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
  </UCard>
</template>
