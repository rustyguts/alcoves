<script setup lang="ts">
import { ref, watch } from "vue";
import type { Moment } from "~~/shared/types/api";

const props = defineProps<{
  moment: Moment | null;
  currentTime: number;
  duration: number;
  downloadPending?: boolean;
}>();

const emit = defineEmits<{
  save: [patch: { name: string; description: string; startSeconds: number; endSeconds: number }];
  "set-to-playhead": [field: "start" | "end"];
  delete: [momentId: string];
  close: [];
  export: [momentId: string];
  download: [momentId: string];
  share: [momentId: string];
}>();

const name = ref("");
const description = ref("");
const startSeconds = ref(0);
const endSeconds = ref(0);

watch(
  () => props.moment,
  (m) => {
    if (!m) return;
    name.value = m.name;
    description.value = m.description;
    startSeconds.value = m.startSeconds;
    endSeconds.value = m.endSeconds;
  },
  { immediate: true },
);

function onSave() {
  if (!props.moment) return;
  const start = Math.max(0, Number(startSeconds.value) || 0);
  const end = Math.max(start + 0.001, Number(endSeconds.value) || 0);
  emit("save", {
    name: name.value,
    description: description.value,
    startSeconds: start,
    endSeconds: end,
  });
}

function onDelete() {
  if (!props.moment) return;
  emit("delete", props.moment.id);
}
</script>

<template>
  <UCard v-if="moment" :ui="{ body: 'p-3 sm:p-3', header: 'p-3 sm:p-3', footer: 'p-3 sm:p-3' }">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-semibold">Edit moment</p>
        <div class="flex items-center gap-1">
          <UTooltip text="Reprocess">
            <UButton
              color="primary"
              variant="soft"
              size="xs"
              icon="i-lucide-refresh-cw"
              :disabled="moment.exportStatus === 'queued' || moment.exportStatus === 'processing'"
              @click="emit('export', moment.id)"
            >
              Reprocess
            </UButton>
          </UTooltip>
          <UTooltip text="Download">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-download"
              square
              :loading="downloadPending"
              @click="emit('download', moment.id)"
            />
          </UTooltip>
          <UTooltip text="Share">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-share-2"
              square
              @click="emit('share', moment.id)"
            />
          </UTooltip>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            square
            aria-label="Close"
            @click="emit('close')"
          />
        </div>
      </div>
    </template>

    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <label class="text-xs font-medium text-muted w-24 shrink-0">Name</label>
        <UInput v-model="name" size="xs" placeholder="Untitled" :ui="{ root: 'flex-1 min-w-0' }" />
      </div>

      <div class="flex gap-2">
        <label class="text-xs font-medium text-muted w-24 shrink-0 self-start pt-1.5">
          Description
        </label>
        <UTextarea
          v-model="description"
          size="xs"
          placeholder="Notes"
          :rows="2"
          class="flex-1 min-w-0"
        />
      </div>

      <div class="flex flex-wrap gap-x-2 gap-y-2">
        <div class="flex items-center gap-2 flex-1 min-w-[220px]">
          <label class="text-xs font-medium text-muted w-24 shrink-0">Start</label>
          <UInput
            v-model="startSeconds"
            size="xs"
            type="number"
            step="0.01"
            min="0"
            :max="duration"
            :ui="{ root: 'flex-1 min-w-0' }"
          />
          <UTooltip text="Set to playhead">
            <UButton
              color="primary"
              variant="ghost"
              size="xs"
              icon="i-lucide-crosshair"
              square
              @click="emit('set-to-playhead', 'start')"
            />
          </UTooltip>
        </div>

        <div class="flex items-center gap-2 flex-1 min-w-[220px]">
          <label class="text-xs font-medium text-muted w-24 shrink-0">End</label>
          <UInput
            v-model="endSeconds"
            size="xs"
            type="number"
            step="0.01"
            min="0"
            :max="duration"
            :ui="{ root: 'flex-1 min-w-0' }"
          />
          <UTooltip text="Set to playhead">
            <UButton
              color="primary"
              variant="ghost"
              size="xs"
              icon="i-lucide-crosshair"
              square
              @click="emit('set-to-playhead', 'end')"
            />
          </UTooltip>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton color="error" variant="soft" size="xs" icon="i-lucide-trash-2" @click="onDelete">
          Delete
        </UButton>
        <UButton color="primary" size="xs" icon="i-lucide-save" @click="onSave"> Save </UButton>
      </div>
    </template>
  </UCard>
</template>
