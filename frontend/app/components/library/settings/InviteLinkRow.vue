<script setup lang="ts">
import type { LibraryPendingInvite } from "~~/shared/types/api";
import AppIcon from "~/components/AppIcon.vue";

interface Props {
  invite: LibraryPendingInvite;
  revoking: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  copy: [inviteUrl: string];
  revoke: [inviteId: string];
}>();
</script>

<template>
  <div class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3">
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium truncate">{{ invite.inviteUrl }}</p>
      <p class="text-xs text-muted">
        Used {{ invite.useCount }} {{ invite.useCount === 1 ? "time" : "times" }}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn btn-soft btn-sm btn-ghost btn-outline" @click="emit('copy', invite.inviteUrl)">
        <AppIcon name="i-lucide-copy" class="size-4" />
      </button>
      <button
        class="btn btn-sm btn-error btn-soft"
        :disabled="revoking"
        @click="emit('revoke', invite.id)"
      >
        <span v-if="revoking" class="loading loading-spinner loading-xs"></span>
        <AppIcon v-else name="i-lucide-x" class="size-4" />
      </button>
    </div>
  </div>
</template>
