<script setup lang="ts">
interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass?: string;
  confirmIcon?: string;
  pending?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  confirmClass: "",
  confirmIcon: "i-lucide-check",
  pending: false,
});

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
  confirm: [];
}>();

const confirmColor = computed<"primary" | "error" | "warning" | "success" | "neutral">(() => {
  const c = props.confirmClass;
  if (c.includes("error")) return "error";
  if (c.includes("warning")) return "warning";
  if (c.includes("success")) return "success";
  if (c.includes("neutral")) return "neutral";
  return "primary";
});
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="message">
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" :disabled="pending" @click="open = false">
          Cancel
        </UButton>
        <UButton
          :color="confirmColor"
          :icon="pending ? undefined : confirmIcon"
          :loading="pending"
          :disabled="pending"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
