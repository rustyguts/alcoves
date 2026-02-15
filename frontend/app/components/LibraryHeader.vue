<script setup lang="ts">
import EmojiPicker from "~/components/EmojiPicker.vue";

const props = defineProps<{
  name?: string;
  emoji?: string | null;
  canEdit?: boolean;
}>();

const emit = defineEmits<{
  "update:name": [value: string];
  "update:emoji": [value: string | null];
}>();

const editingName = ref(false);
const editName = ref("");

function startRename() {
  if (!props.canEdit) return;
  editName.value = props.name ?? "";
  editingName.value = true;
}

function saveName() {
  editingName.value = false;
  const trimmed = editName.value.trim();
  if (!trimmed || trimmed === props.name) return;
  emit("update:name", trimmed);
}
</script>

<template>
  <div class="flex items-center justify-between gap-3 min-h-12">
    <div class="flex items-center gap-2 min-w-0">
      <EmojiPicker
        v-if="canEdit"
        :model-value="emoji ?? null"
        @update:model-value="emit('update:emoji', $event)"
      />
      <span v-else-if="emoji" class="text-2xl leading-none">{{ emoji }}</span>
      <h1
        v-if="!editingName"
        class="text-2xl font-semibold truncate"
        :class="canEdit ? 'cursor-pointer hover:text-primary' : ''"
        @click="startRename"
      >
        {{ name }}
      </h1>
      <input
        v-else
        v-model="editName"
        autofocus
        class="input input-lg w-full"
        @blur="saveName"
        @keydown.enter="saveName"
        @keydown.escape="editingName = false"
      />
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
