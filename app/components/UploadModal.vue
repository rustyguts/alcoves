<script setup lang="ts">
import { getMimeTypeFromFilename } from "~/utils/mime-icons";

const props = defineProps<{
  libraryId: string;
}>();

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{
  complete: [];
}>();

const uploadFiles = ref<File[]>([]);
const uploading = ref(false);

async function handleUpload() {
  if (!uploadFiles.value.length) return;
  uploading.value = true;

  for (const file of uploadFiles.value) {
    await $fetch(`/api/libraries/${props.libraryId}/files`, {
      method: "POST",
      body: {
        name: file.name,
        mimeType: getMimeTypeFromFilename(file.name),
        size: file.size,
      },
    });
  }

  uploading.value = false;
  uploadFiles.value = [];
  emit("complete");
}

function handleClose() {
  if (!uploading.value) {
    uploadFiles.value = [];
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Upload Files" @after:leave="handleClose">
    <template #body>
      <UFileUpload
        v-model="uploadFiles"
        multiple
        label="Drop files here or click to browse"
        description="Any file type accepted"
        layout="list"
        class="min-h-40"
      />
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="uploading"
          @click="open = false"
        />
        <UButton
          label="Upload"
          icon="i-lucide-upload"
          :loading="uploading"
          :disabled="!uploadFiles.length"
          @click="handleUpload"
        />
      </div>
    </template>
  </UModal>
</template>
