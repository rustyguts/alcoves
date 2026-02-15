<script setup lang="ts">
import type { LibraryFile } from "~~/shared/types/api";
import { apiFetch } from "~/utils/api-fetch";
import { useToast } from "~/composables/useToast";

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
    await apiFetch(`/api/libraries/${props.libraryId}/files/${props.file.id}/clip`, {
      method: "POST",
      body: {
        startTime: startTime.value,
        endTime: endTime.value,
        name: clipName.value || undefined,
      },
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
  <dialog class="modal" :class="{ 'modal-open': open }">
    <div class="modal-box">
      <h3 class="text-lg font-bold">Create Video Clip</h3>

      <div class="flex flex-col gap-4 py-4">
        <p class="text-sm text-muted">
          Select a time range from <strong>{{ file.name }}</strong> to create a new clip.
        </p>

        <div class="grid grid-cols-2 gap-3">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Start Time (seconds)</legend>
            <input
              v-model.number="startTime"
              type="number"
              min="0"
              :max="endTime"
              step="0.1"
              class="input w-full"
            />
            <p class="label">{{ formatTime(startTime) }}</p>
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">End Time (seconds)</legend>
            <input
              v-model.number="endTime"
              type="number"
              :min="startTime"
              :max="file.duration ?? 9999"
              step="0.1"
              class="input w-full"
            />
            <p class="label">{{ formatTime(endTime) }}</p>
          </fieldset>
        </div>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Clip Name (optional)</legend>
          <input
            v-model="clipName"
            class="input w-full"
            :placeholder="`${file.name.replace(/\.[^.]+$/, '')}_clip`"
          />
        </fieldset>

        <div class="flex justify-end gap-2 pt-2">
          <button class="btn btn-sm btn-outline btn-neutral" @click="open = false">Cancel</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="loading"
            @click="createClip"
          >
            <span v-if="loading" class="loading loading-spinner loading-xs"></span>
            Create Clip
          </button>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="open = false">
      <button>close</button>
    </form>
  </dialog>
</template>
