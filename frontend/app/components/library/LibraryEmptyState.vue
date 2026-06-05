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
    <div class="size-16 rounded-full bg-elevated flex items-center justify-center mb-4">
      <AppIcon
        :name="showTrashed ? 'i-lineicons-trash-can' : 'i-lineicons-folder'"
        class="size-8 text-muted"
      />
    </div>
    <p class="text-lg font-medium text-default mb-1">{{ title }}</p>
    <p class="text-sm text-muted mb-4">{{ description }}</p>
    <div v-if="canManageLibrary && !showTrashed" class="flex items-center gap-2">
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lineicons-folder"
        @click="emit('createFolder')"
      >
        Create folder
      </UButton>
      <UButton color="primary" variant="soft" icon="i-lineicons-upload" @click="emit('uploadFiles')">
        Upload files
      </UButton>
    </div>
  </div>
</template>
