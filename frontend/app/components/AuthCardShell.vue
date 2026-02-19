<script setup lang="ts">
interface Props {
  title: string;
  subtitle: string;
  error?: string;
}

withDefaults(defineProps<Props>(), {
  error: "",
});
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-4">
    <div class="w-full max-w-md space-y-6">
      <div class="flex flex-col items-center gap-2">
        <img src="/logo.webp" alt="Alcoves" width="96" height="96" />
        <h2 class="text-2xl font-bold">{{ title }}</h2>
        <p class="text-sm text-base-content/60">{{ subtitle }}</p>
        <p v-if="error" class="text-sm text-error mt-1">{{ error }}</p>
      </div>

      <slot />

      <slot name="footer" />
    </div>
  </div>
</template>
