<script setup lang="ts" generic="T">
import { ICONS } from "~/utils/icons";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { justifiedLayout, type JustifiedRow } from "~/utils/justified-layout";
import type { GalleryGroup, GalleryItem } from "~/utils/gallery-types";
import { getMimeIcon } from "~/utils/mime-icons";
import AlcovesImage from "~/components/AlcovesImage.vue";
import AppIcon from "~/components/AppIcon.vue";

/**
 * Justified (Google-Photos-style) media gallery. Lays each group's items into
 * rows that fill the available width edge-to-edge at their native aspect ratio.
 * Purely presentational — the parent owns data loading, grouping, and what
 * `select` does. Tracks its own width via a ResizeObserver so rows reflow on
 * resize.
 *
 * Two modes:
 *   - default: one justified block per group, with a sticky group heading and
 *     optional large section divider (used by global search). The trailing row
 *     of each group is left ragged (not stretched).
 *   - `continuous`: one justified block per group (day), each under a real
 *     heading band, with every group's trailing row stretched to full width so
 *     the grid fills the container edge-to-edge — Google-Photos style. The
 *     section carries `data-group-key` as a scroll anchor (used by the timeline).
 */

const props = withDefaults(
  defineProps<{
    groups: GalleryGroup<T>[];
    gap?: number;
    targetRowHeight?: number;
    maxRowHeight?: number;
    continuous?: boolean;
  }>(),
  {
    gap: 3,
    targetRowHeight: 200,
    maxRowHeight: 320,
    continuous: false,
  },
);

const emit = defineEmits<{ select: [item: T] }>();

const rootEl = ref<HTMLElement | null>(null);
const width = ref(0);
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!rootEl.value) return;
  width.value = rootEl.value.clientWidth;
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) width.value = entry.contentRect.width;
  });
  resizeObserver.observe(rootEl.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

interface LaidOutGroup {
  group: GalleryGroup<T>;
  rows: JustifiedRow<GalleryItem<T>>[];
}

// Justify a single group's items at the current container width. `stretchLastRow`
// fills the trailing row edge-to-edge (continuous/timeline mode) versus leaving
// it ragged (default/search mode).
function layoutGroup(group: GalleryGroup<T>, stretchLastRow: boolean): LaidOutGroup {
  return {
    group,
    rows: justifiedLayout(group.items, (i) => i.aspect, {
      containerWidth: width.value,
      targetRowHeight: props.targetRowHeight,
      gap: props.gap,
      maxRowHeight: props.maxRowHeight,
      stretchLastRow,
    }),
  };
}

// Default mode: one justified block per group (ragged trailing row, sticky heading).
const laidOut = computed<LaidOutGroup[]>(() =>
  props.continuous ? [] : props.groups.map((g) => layoutGroup(g, false)),
);

// Continuous (timeline) mode: one justified block per DAY, each day's trailing
// row stretched to full width, with a real heading band above each day.
const laidOutContinuous = computed<LaidOutGroup[]>(() =>
  props.continuous ? props.groups.map((g) => layoutGroup(g, true)) : [],
);
</script>

<template>
  <div ref="rootEl">
    <!-- Continuous (timeline): one section per day, full-width rows, heading band. -->
    <template v-if="continuous">
      <section
        v-for="entry in laidOutContinuous"
        :key="entry.group.key"
        :data-group-key="entry.group.key"
        class="mb-6"
      >
        <div class="flex items-baseline gap-2 px-1 pt-5 pb-2 first:pt-1">
          <h3 class="text-sm font-semibold text-default">{{ entry.group.heading }}</h3>
          <span class="text-xs text-dimmed tabular-nums">{{ entry.group.count }}</span>
        </div>

        <div class="flex flex-col" :style="{ gap: `${gap}px` }">
          <div v-for="(row, ri) in entry.rows" :key="ri" class="flex" :style="{ gap: `${gap}px` }">
            <button
              v-for="box in row.boxes"
              :key="box.item.id"
              type="button"
              class="group relative cursor-pointer overflow-hidden rounded-[2px] bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10"
              :style="{ width: `${box.width}px`, height: `${box.height}px` }"
              :title="box.item.name"
              @click="emit('select', box.item.raw)"
            >
              <AlcovesImage
                v-if="box.item.thumbnailFileId"
                :library-id="box.item.libraryId"
                :file-id="box.item.thumbnailFileId"
                :source-width="box.item.sourceWidth"
                :source-height="box.item.sourceHeight"
                :alt="box.item.name"
                variant="timeline"
                class="h-full w-full object-cover transition duration-200 group-hover:brightness-110"
              />
              <span v-else class="flex h-full w-full items-center justify-center text-dimmed">
                <AppIcon :name="getMimeIcon(box.item.mime)" class="size-7" />
              </span>

              <!-- Video duration (no play icon) -->
              <span
                v-if="box.item.isVideo && box.item.durationLabel"
                class="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums text-white"
              >
                {{ box.item.durationLabel }}
              </span>
            </button>
          </div>
        </div>
      </section>
    </template>

    <!-- Default: one justified block per group with sticky headings. -->
    <template v-for="entry in laidOut" v-else :key="entry.group.key">
      <!-- Optional large section divider (e.g. a month) -->
      <h2
        v-if="entry.group.sectionLabel"
        class="pt-6 pb-1 text-2xl font-semibold tracking-tight text-default first:pt-3"
      >
        {{ entry.group.sectionLabel }}
      </h2>

      <section class="mb-5">
        <h3
          class="sticky top-0 z-10 py-1.5 bg-default/85 backdrop-blur flex items-baseline gap-2"
        >
          <span class="text-sm font-medium text-default truncate">{{ entry.group.heading }}</span>
          <span class="text-xs text-dimmed shrink-0">{{ entry.group.count }}</span>
        </h3>

        <div class="mt-1.5 flex flex-col" :style="{ gap: `${gap}px` }">
          <div v-for="(row, ri) in entry.rows" :key="ri" class="flex" :style="{ gap: `${gap}px` }">
            <button
              v-for="box in row.boxes"
              :key="box.item.id"
              type="button"
              class="group relative cursor-pointer overflow-hidden rounded-[2px] bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10"
              :style="{ width: `${box.width}px`, height: `${box.height}px` }"
              :title="box.item.name"
              @click="emit('select', box.item.raw)"
            >
              <AlcovesImage
                v-if="box.item.thumbnailFileId"
                :library-id="box.item.libraryId"
                :file-id="box.item.thumbnailFileId"
                :source-width="box.item.sourceWidth"
                :source-height="box.item.sourceHeight"
                :alt="box.item.name"
                variant="timeline"
                class="h-full w-full object-cover transition duration-200 group-hover:brightness-110"
              />
              <span v-else class="flex h-full w-full items-center justify-center text-dimmed">
                <AppIcon :name="getMimeIcon(box.item.mime)" class="size-7" />
              </span>

              <!-- Matched-label / metadata badge -->
              <span
                v-if="box.item.badge"
                class="absolute left-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                {{ box.item.badge }}
              </span>

              <!-- Video affordance: duration when known, else a play badge so a
                   video is still distinguishable (search results carry no duration). -->
              <span
                v-if="box.item.isVideo"
                class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/45 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
              />
              <span
                v-if="box.item.isVideo && box.item.durationLabel"
                class="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium leading-none tabular-nums text-white"
              >
                {{ box.item.durationLabel }}
              </span>
              <span
                v-else-if="box.item.isVideo"
                class="absolute bottom-1.5 right-1.5 rounded bg-black/60 p-0.5 text-white"
              >
                <AppIcon :name="ICONS.play" class="size-3" />
              </span>
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
