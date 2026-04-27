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
  <div class="flex min-h-svh items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-950">
    <div class="w-full max-w-md">
      <UCard>
        <div class="flex flex-col items-center gap-3 mb-6">
          <img src="/logo.webp" alt="Alcoves" width="72" height="72" class="rounded-xl" />
          <h2 class="text-2xl font-bold text-highlighted">{{ title }}</h2>
          <p class="text-sm text-muted text-center">{{ subtitle }}</p>
        </div>

        <UAlert v-if="error" color="error" variant="soft" :description="error" class="mb-4" />

        <slot />

        <template #footer>
          <slot name="footer" />
        </template>
      </UCard>
    </div>
  </div>
</template>
