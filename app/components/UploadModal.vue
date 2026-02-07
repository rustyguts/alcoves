<script setup lang="ts">
const props = defineProps<{
  libraryId: string;
  libraryName: string;
  parentFolderId: string | null;
}>();

const open = defineModel<boolean>("open", { default: false });

const { addFiles } = useUploadQueue();
const selectedFiles = ref<File[]>([]);

function handleUpload() {
  if (!selectedFiles.value.length) return;
  addFiles(selectedFiles.value, props.libraryId, props.libraryName, props.parentFolderId);
  selectedFiles.value = [];
  open.value = false;
}

function handleClose() {
  selectedFiles.value = [];
}
</script>

<template>
  <UModal v-model:open="open" title="Upload Files" @after:leave="handleClose">
    <template #body>
      <p class="text-sm text-muted mb-3">
        Uploading to <strong>{{ libraryName }}</strong>
      </p>
      <UFileUpload
        v-model="selectedFiles"
        multiple
        label="Drop files here or click to browse"
        description="Any file type accepted"
        layout="list"
        class="min-h-40"
      />
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton label="Cancel" color="neutral" variant="outline" @click="open = false" />
        <UButton
          label="Upload"
          icon="i-lucide-upload"
          :disabled="!selectedFiles.length"
          @click="handleUpload"
        />
      </div>
    </template>
  </UModal>
</template>
