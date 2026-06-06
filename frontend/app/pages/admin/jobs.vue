<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import AdminJobsPanel from "~/components/admin/AdminJobsPanel.vue";

definePageMeta({ layout: "dashboard" });
</script>

<template>
  <div class="flex flex-col gap-6 overflow-y-auto flex-1 min-h-0 px-0.5">
    <UButton
      to="/admin"
      color="neutral"
      variant="ghost"
      :icon="ICONS.back"
      size="sm"
      class="self-start"
    >
      Back to Admin
    </UButton>

    <AdminJobsPanel />
  </div>
</template>
