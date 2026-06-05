<script setup lang="ts">
/**
 * Timeline year scrubber — a slim fixed rail down the right edge of the timeline
 * (Google-Photos style). Lists each year present in the gallery, newest at the
 * top, joined by dotted ticks. Clicking a year scrolls its newest day into view;
 * the parent owns the actual scroll via the `jump` event (passed the day key).
 */
defineProps<{
  years: { year: number; key: string }[];
}>();

const emit = defineEmits<{ jump: [key: string] }>();
</script>

<template>
  <aside
    class="flex w-11 shrink-0 select-none flex-col items-center overflow-hidden border-l border-default py-3"
    aria-label="Jump to year"
  >
    <template v-for="(y, i) in years" :key="y.year">
      <button
        type="button"
        class="cursor-pointer rounded px-1 py-0.5 text-[11px] font-medium tabular-nums text-muted transition-colors hover:bg-elevated hover:text-default"
        @click="emit('jump', y.key)"
      >
        {{ y.year }}
      </button>
      <!-- Dotted tick line filling the gap between two years -->
      <div
        v-if="i < years.length - 1"
        class="flex min-h-4 flex-1 flex-col items-center justify-evenly py-1.5 text-dimmed"
        aria-hidden="true"
      >
        <span v-for="n in 4" :key="n" class="size-[3px] rounded-full bg-current opacity-60" />
      </div>
    </template>
  </aside>
</template>
