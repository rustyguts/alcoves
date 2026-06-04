<script setup lang="ts">
/**
 * AppPanelRow — a label/description pair on the left, a control on the right.
 *
 * The recurring settings row. `min-w-0` + the right column's `shrink-0` keep
 * long descriptions wrapping instead of shoving the control off-screen, and
 * the text block grows the row rather than clipping.
 */
interface Props {
  title: string;
  description?: string;
  /** Render the title in the error color (danger-zone rows). */
  danger?: boolean;
  /** Vertically center the control against the text (default) or top-align it. */
  align?: "center" | "start";
}

withDefaults(defineProps<Props>(), { align: "center" });
</script>

<template>
  <div
    class="flex flex-col gap-3 sm:flex-row sm:justify-between sm:gap-4"
    :class="align === 'center' ? 'sm:items-center' : 'sm:items-start'"
  >
    <div class="min-w-0 space-y-0.5">
      <p class="text-sm font-medium" :class="danger ? 'text-error' : 'text-highlighted'">
        {{ title }}
      </p>
      <p v-if="description" class="text-xs text-muted">{{ description }}</p>
      <slot name="description" />
    </div>
    <div class="shrink-0">
      <slot />
    </div>
  </div>
</template>
