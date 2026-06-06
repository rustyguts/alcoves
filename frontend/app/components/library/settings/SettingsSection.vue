<script setup lang="ts">
/**
 * SettingsSection — the flat, card-free section used on the library settings
 * page.
 *
 * Where AppPanel wraps a UCard (a filled tonal block that still reads as a
 * card), a SettingsSection lays its content directly on the page background.
 * Stack a column of these inside a `divide-y divide-default` wrapper and the
 * page becomes a clean flat list: each group is just an icon + title +
 * description header with its controls below, separated from its neighbours by
 * a single hairline rule. Mirrors AppPanel's API (title / description / icon +
 * `#title` and `#actions` slots) so swapping is mechanical.
 */
interface Props {
  title?: string;
  description?: string;
  icon?: string;
}

const props = defineProps<Props>();
const slots = useSlots();

const hasHeader = computed(
  () => !!(props.title || props.icon || slots.title || slots.actions || props.description),
);
</script>

<template>
  <section class="py-6 first:pt-0 last:pb-0">
    <div v-if="hasHeader" class="flex items-start justify-between gap-3">
      <div class="min-w-0 space-y-0.5">
        <slot name="title">
          <div class="flex items-center gap-2">
            <UIcon v-if="icon" :name="icon" class="size-4 shrink-0 text-primary" />
            <h2 class="text-sm font-semibold text-highlighted">{{ title }}</h2>
          </div>
        </slot>
        <p v-if="description" class="max-w-prose text-xs text-muted">{{ description }}</p>
      </div>
      <div v-if="slots.actions" class="flex shrink-0 items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="slots.default" :class="hasHeader ? 'mt-4' : ''">
      <slot />
    </div>
  </section>
</template>
