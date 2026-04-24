<script setup lang="ts">
import type { LibraryFile } from "~~/shared/types/api";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import AppModal from "~/components/AppModal.vue";

const props = defineProps<{
  file: LibraryFile;
  libraryId: string;
}>();

const emit = defineEmits<{
  created: [];
}>();

const open = defineModel<boolean>("open", { default: false });
const toast = useToast();

const startTime = ref(0);
const endTime = ref(0);
const clipName = ref("");
const loading = ref(false);

watch(
  () => props.file,
  (f) => {
    startTime.value = 0;
    endTime.value = f?.duration ?? 10;
    clipName.value = "";
  },
  { immediate: true },
);

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function createClip() {
  if (endTime.value <= startTime.value) {
    toast.add({ title: "End time must be after start time", color: "error" });
    return;
  }

  loading.value = true;
  try {
    await api.files.clip(props.libraryId, props.file.id, {
      startTime: startTime.value,
      endTime: endTime.value,
      name: clipName.value || undefined,
    });
    toast.add({ title: "Clip created", color: "success" });
    open.value = false;
    emit("created");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create clip";
    toast.add({ title: message, color: "error" });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AppModal v-model:open="open">
    <h3 class="text-lg font-bold">Create Video Clip</h3>

    <div class="flex flex-col gap-4 py-4">
      <p class="text-sm text-muted">
        Select a time range from <strong>{{ file.name }}</strong> to create a new clip.
      </p>

      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Start Time (seconds)">
          <UInput
            v-model.number="startTime"
            type="number"
            min="0"
            :max="endTime"
            step="0.1"
            :ui="{ root: 'w-full' }"
          />
          <template #help>{{ formatTime(startTime) }}</template>
        </UFormField>
        <UFormField label="End Time (seconds)">
          <UInput
            v-model.number="endTime"
            type="number"
            :min="startTime"
            :max="file.duration ?? 9999"
            step="0.1"
            :ui="{ root: 'w-full' }"
          />
          <template #help>{{ formatTime(endTime) }}</template>
        </UFormField>
      </div>

      <UFormField label="Clip Name (optional)">
        <UInput
          v-model="clipName"
          :placeholder="`${file.name.replace(/\.[^.]+$/, '')}_clip`"
          :ui="{ root: 'w-full' }"
        />
      </UFormField>

      <div class="flex justify-end gap-2 pt-2">
        <UButton color="neutral" variant="soft" size="sm" @click="open = false">Cancel</UButton>
        <UButton
          color="primary"
          variant="soft"
          size="sm"
          :loading="loading"
          :disabled="loading"
          @click="createClip"
        >
          Create Clip
        </UButton>
      </div>
    </div>
  </AppModal>
</template>
