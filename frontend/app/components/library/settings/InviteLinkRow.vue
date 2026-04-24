<script setup lang="ts">
import type { LibraryPendingInvite } from "~~/shared/types/api";

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
      <UButton
        color="neutral"
        variant="soft"
        size="sm"
        icon="i-lucide-copy"
        square
        @click="emit('copy', invite.inviteUrl)"
      />
      <UButton
        color="error"
        variant="soft"
        size="sm"
        icon="i-lucide-x"
        square
        :loading="revoking"
        :disabled="revoking"
        @click="emit('revoke', invite.id)"
      />
    </div>
  </div>
</template>
