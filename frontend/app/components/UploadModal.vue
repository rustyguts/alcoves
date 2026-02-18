<script setup lang="ts">
import { useUploadQueue } from "~/composables/useUploadQueue";
import AppIcon from "~/components/AppIcon.vue";

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
  <dialog class="modal" :class="{ 'modal-open': open }">
    <div class="modal-box">
      <h3 class="text-lg font-bold">Upload Files</h3>

      <div class="py-4">
        <p class="text-sm text-muted mb-3">
          Uploading to <strong>{{ libraryName }}</strong>
        </p>

        <input
          type="file"
          class="file-input w-full"
          multiple
          @change="onFileChange"
        />

        <p v-if="selectedFileCount" class="mt-3 text-sm text-muted">
          {{ selectedFileCount }} file{{ selectedFileCount === 1 ? "" : "s" }} selected
        </p>
      </div>

      <div class="flex justify-end gap-2">
        <button class="btn btn-sm" @click="open = false">Cancel</button>
        <button
          class="btn btn-sm btn-primary"
          :disabled="!selectedFileCount"
          @click="handleUpload"
        >
          <AppIcon name="i-lucide-upload" class="size-4" />
          Upload
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="open = false">
      <button>close</button>
    </form>
  </dialog>
</template>
