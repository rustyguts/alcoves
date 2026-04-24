<script setup lang="ts">
import AdminJobsPanel from "~/components/admin/AdminJobsPanel.vue";
</script>

<template>
  <div class="flex flex-col gap-6 overflow-y-auto flex-1 min-h-0">
    <UButton
      to="/admin"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
      size="sm"
      class="self-start"
    >
      Back to Admin
    </UButton>

    <AdminJobsPanel />
  </div>
</template>
