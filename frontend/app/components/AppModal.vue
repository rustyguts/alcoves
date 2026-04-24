<script setup lang="ts">
interface Props {
  boxClass?: string;
  title?: string;
  description?: string;
}

withDefaults(defineProps<Props>(), {
  boxClass: "",
  title: "",
  description: "",
});

const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description" :ui="{ content: boxClass }">
    <template #body>
      <slot />
    </template>
  </UModal>
</template>
