<script setup lang="ts">
definePageMeta({
  layout: "dashboard",
});

await navigateTo("/admin", { replace: true, redirectCode: 301 });
</script>

<template>
  <div />
</template>
