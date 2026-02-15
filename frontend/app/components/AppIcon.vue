<script setup lang="ts">
import { Icon } from "@iconify/vue";

const props = defineProps<{
  name: string;
}>();

/**
 * Convert Nuxt UI icon format (i-lucide-xxx) to Iconify format (lucide:xxx).
 */
const iconName = computed(() => {
  const raw = props.name;
  if (raw.startsWith("i-")) {
    // i-lucide-chevron-left -> lucide:chevron-left
    const withoutPrefix = raw.slice(2);
    const dashIdx = withoutPrefix.indexOf("-");
    if (dashIdx > 0) {
      const collection = withoutPrefix.slice(0, dashIdx);
      const name = withoutPrefix.slice(dashIdx + 1);
      return `${collection}:${name}`;
    }
  }
  return raw;
});
</script>

<template>
  <Icon :icon="iconName" />
</template>
