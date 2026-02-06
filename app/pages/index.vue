<script setup lang="ts">
import type { Library } from "~~/server/utils/types";

const { data: libraries } = await useFetch<Library[]>("/api/libraries");

const defaultLibrary = libraries.value?.find((l) => l.isDefault);

if (defaultLibrary) {
  await navigateTo(`/libraries/${defaultLibrary.id}`, { replace: true });
}
</script>

<template>
  <div />
</template>
