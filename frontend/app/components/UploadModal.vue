<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { useUploadQueue } from "~/composables/useUploadQueue";
import AppModal from "~/components/AppModal.vue";

const props = defineProps<{
  libraryId: string;
  libraryName: string;
  parentFolderId: string | null;
}>();

const open = defineModel<boolean>("open", { default: false });

const { addFiles } = useUploadQueue();
const selectedFiles = ref<File[]>([]);
const selectedFileCount = computed(() => selectedFiles.value.length);

function handleUpload() {
  if (!selectedFileCount.value) return;
  addFiles(selectedFiles.value, props.libraryId, props.libraryName, props.parentFolderId);
  selectedFiles.value = [];
  open.value = false;
}

function handleClose() {
  selectedFiles.value = [];
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files) {
    selectedFiles.value = Array.from(target.files);
  }
}

watch(open, (val) => {
  if (!val) handleClose();
});
</script>

<template>
  <AppModal v-model:open="open">
    <h3 class="text-lg font-bold">Upload Files</h3>

    <div class="py-4">
      <p class="text-sm text-muted mb-3">
        Uploading to <strong>{{ libraryName }}</strong>
      </p>

      <input
        type="file"
        class="block w-full text-sm text-default file:mr-3 file:rounded-md file:border-0 file:bg-elevated file:px-3 file:py-2 file:text-sm file:font-medium file:text-default hover:file:bg-accented/70 cursor-pointer"
        multiple
        @change="onFileChange"
      />

      <p v-if="selectedFileCount" class="mt-3 text-sm text-muted">
        {{ selectedFileCount }} file{{ selectedFileCount === 1 ? "" : "s" }} selected
      </p>
    </div>

    <div class="flex justify-end gap-2">
      <UButton color="neutral" variant="soft" size="sm" @click="open = false">Cancel</UButton>
      <UButton
        color="primary"
        variant="soft"
        size="sm"
        :icon="ICONS.upload"
        :disabled="!selectedFileCount"
        @click="handleUpload"
      >
        Upload
      </UButton>
    </div>
  </AppModal>
</template>
