<script setup lang="ts">
import AppIcon from "~/components/AppIcon.vue";

interface Props {
  showTrashed: boolean;
  title: string;
  description: string;
  canManageLibrary: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  createFolder: [];
  uploadFiles: [];
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 px-4">
    <div class="size-16 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center mb-4">
      <AppIcon
        :name="showTrashed ? 'i-lucide-trash-2' : 'i-lucide-folder-open'"
        class="size-8 text-(--ui-text-muted)"
      />
    </div>
    <p class="text-lg font-medium text-foreground mb-1">{{ title }}</p>
    <p class="text-sm text-muted mb-4">{{ description }}</p>
    <div v-if="canManageLibrary && !showTrashed" class="flex items-center gap-2">
      <button class="btn btn-soft btn-outline" @click="emit('createFolder')">
        <AppIcon name="i-lucide-folder-plus" class="size-4" />
        Create folder
      </button>
      <button class="btn btn-soft btn-primary" @click="emit('uploadFiles')">
        <AppIcon name="i-lucide-upload" class="size-4" />
        Upload files
      </button>
    </div>
  </div>
</template>
