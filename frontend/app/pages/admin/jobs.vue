<script setup lang="ts">
import AdminJobsPanel from "~/components/admin/AdminJobsPanel.vue";
import AppIcon from "~/components/AppIcon.vue";
</script>

<template>
  <div class="flex flex-col gap-6 overflow-y-auto flex-1 min-h-0">
    <div>
      <RouterLink to="/admin" class="btn btn-sm btn-ghost gap-2">
        <AppIcon name="i-lucide-arrow-left" class="size-4" />
        Back to Admin
      </RouterLink>
    </div>

    <AdminJobsPanel />
  </div>
</template>
