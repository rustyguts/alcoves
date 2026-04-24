<script setup lang="ts">
defineProps<{
  name: string;
}>();
</script>

<template>
  <UIcon :name="name" />
</template>
