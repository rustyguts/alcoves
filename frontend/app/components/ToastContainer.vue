<script setup lang="ts">
import { useToast } from "~/composables/useToast";

const { toasts, remove } = useToast();

const colorClass: Record<string, string> = {
  success: "alert-success",
  error: "alert-error",
  warning: "alert-warning",
  info: "alert-info",
  neutral: "",
  primary: "alert-info",
};
</script>

<template>
  <Teleport to="body">
    <div class="toast toast-end toast-bottom z-[100]">
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-x-4 opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="translate-x-4 opacity-0"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="alert shadow-lg cursor-pointer"
          :class="colorClass[toast.color ?? 'neutral']"
          @click="remove(toast.id)"
        >
          <div>
            <span class="font-medium">{{ toast.title }}</span>
            <span v-if="toast.description" class="text-xs opacity-70 block">{{
              toast.description
            }}</span>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
