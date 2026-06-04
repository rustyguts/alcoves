<script setup lang="ts">
import LibraryBreadcrumb from "~/components/LibraryBreadcrumb.vue";

/**
 * The shared chrome at the top of every library tab: an emoji prefix + the
 * breadcrumb heading (row 1) and the tabs (default slot, row 2). The library
 * name and emoji are display-only here — renaming and emoji editing live on the
 * Settings tab.
 */
defineProps<{
  libraryId: string;
  name?: string;
  emoji?: string | null;
}>();

const slots = useSlots();
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-3 min-h-12">
      <div class="flex min-w-0 items-center gap-2">
        <span v-if="emoji" class="shrink-0 text-2xl leading-none">{{ emoji }}</span>
        <LibraryBreadcrumb class="min-w-0" :library-id="libraryId" :library-name="name" />
      </div>
      <div v-if="slots.actions" class="flex shrink-0 items-center gap-3">
        <slot name="actions" />
      </div>
    </div>
    <div v-if="slots.default" class="mt-3">
      <slot />
    </div>
  </div>
</template>
