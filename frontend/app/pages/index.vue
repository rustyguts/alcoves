<script setup lang="ts">
import { useApiFetch } from "~/composables/useApiFetch";

definePageMeta({ layout: "dashboard" });

interface Library {
  id: string;
  name: string;
  isDefault: boolean;
}

const router = useRouter();

const { data: libraries } = useApiFetch<Library[]>("/api/libraries");

watch(
  libraries,
  (libs) => {
    if (!libs) return;
    const defaultLibrary = libs.find((l) => l.isDefault);
    if (defaultLibrary) {
      router.replace(`/libraries/${defaultLibrary.id}`);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div />
</template>
