<script setup lang="ts">
import AppIcon from "~/components/AppIcon.vue";
import AppModal from "~/components/AppModal.vue";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass?: string;
  confirmIcon?: string;
  pending?: boolean;
}

withDefaults(defineProps<Props>(), {
  confirmClass: "btn-soft btn-primary",
  confirmIcon: "i-lucide-check",
  pending: false,
});

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
  confirm: [];
}>();
</script>

<template>
  <AppModal v-model:open="open">
    <h3 class="text-lg font-bold">{{ title }}</h3>
    <p class="text-sm text-muted py-4">{{ message }}</p>
    <div class="modal-action">
      <button class="btn btn-soft" :disabled="pending" @click="open = false">Cancel</button>
      <button class="btn" :class="confirmClass" :disabled="pending" @click="emit('confirm')">
        <span v-if="pending" class="loading loading-spinner loading-xs"></span>
        <AppIcon v-else :name="confirmIcon" class="size-4" />
        {{ confirmLabel }}
      </button>
    </div>
  </AppModal>
</template>
