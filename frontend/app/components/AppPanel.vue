<script setup lang="ts">
/**
 * AppPanel — the single, consistent "titled card section" used across the app.
 *
 * Replaces the many hand-rolled `<UCard><template #header><div><p
 * font-semibold>…</p><p text-muted>…</p></div></template>` blocks that had
 * drifted into three different title sizes. One header treatment everywhere:
 * an optional icon + `text-sm font-semibold` title, an optional muted
 * description, and an `#actions` slot pinned to the right.
 */
interface Props {
  title?: string;
  description?: string;
  icon?: string;
  /** Remove body padding — for tables / full-bleed lists. */
  flush?: boolean;
  /** Override body padding (takes precedence over `flush`). */
  bodyClass?: string;
}

const props = defineProps<Props>();
const slots = useSlots();

const hasHeader = computed(
  () => !!(props.title || props.icon || slots.title || slots.actions || props.description),
);
const bodyUi = computed(() => {
  if (props.bodyClass) return props.bodyClass;
  if (props.flush) return "p-0";
  return undefined;
});
</script>

<template>
  <UCard :ui="bodyUi ? { body: bodyUi } : undefined">
    <template v-if="hasHeader" #header>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-0.5">
          <slot name="title">
            <div class="flex items-center gap-2">
              <UIcon v-if="icon" :name="icon" class="size-4 shrink-0 text-primary" />
              <h2 class="text-sm font-semibold text-highlighted">{{ title }}</h2>
            </div>
          </slot>
          <p v-if="description" class="text-xs text-muted">{{ description }}</p>
        </div>
        <div v-if="slots.actions" class="flex shrink-0 items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
    </template>

    <slot />
  </UCard>
</template>
