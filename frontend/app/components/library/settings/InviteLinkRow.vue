<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import type { LibraryInviteLink } from "~~/shared/types/api";
import UserAvatar from "~/components/UserAvatar.vue";

interface Props {
  invite: LibraryInviteLink;
  revoking: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  copy: [inviteUrl: string];
  revoke: [inviteId: string];
}>();

const expanded = ref(false);

const usageLabel = computed(() => {
  const used = props.invite.useCount;
  const max = props.invite.maxUses;
  if (max == null) return `${used} ${used === 1 ? "use" : "uses"}`;
  return `${used} / ${max} uses`;
});

const expiresLabel = computed(() => {
  if (!props.invite.expiresAt) return "Never expires";
  const d = new Date(props.invite.expiresAt);
  return `Expires ${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
});

const isExhausted = computed(
  () => props.invite.maxUses != null && props.invite.useCount >= props.invite.maxUses,
);
const isExpired = computed(
  () => props.invite.expiresAt != null && new Date(props.invite.expiresAt).getTime() < Date.now(),
);
const uses = computed(() => props.invite.uses ?? []);
</script>

<template>
  <div class="px-3 py-3 flex flex-col gap-2">
    <div class="flex flex-col md:flex-row md:items-center gap-3">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">{{ invite.inviteUrl }}</p>
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{{ usageLabel }}</span>
          <span>·</span>
          <span>{{ expiresLabel }}</span>
          <UBadge v-if="isExhausted" color="warning" variant="subtle" size="xs">Exhausted</UBadge>
          <UBadge v-if="isExpired" color="error" variant="subtle" size="xs">Expired</UBadge>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          v-if="uses.length"
          color="neutral"
          variant="ghost"
          size="sm"
          :icon="expanded ? ICONS.chevronUp : ICONS.chevronDown"
          @click="expanded = !expanded"
        >
          {{ uses.length }}
        </UButton>
        <UButton
          color="neutral"
          variant="soft"
          size="sm"
          :icon="ICONS.copy"
          square
          @click="emit('copy', invite.inviteUrl)"
        />
        <UButton
          color="error"
          variant="soft"
          size="sm"
          :icon="ICONS.trash"
          square
          :loading="revoking"
          :disabled="revoking"
          @click="emit('revoke', invite.id)"
        />
      </div>
    </div>
    <div
      v-if="expanded && uses.length"
      class="rounded-md border border-default bg-elevated/30 px-3 py-2 space-y-2"
    >
      <div v-for="(u, idx) in uses" :key="idx" class="flex items-center gap-2 text-xs">
        <UserAvatar
          :display-name="u.user.displayName"
          :avatar-url="u.user.avatarUrl"
          size-class="w-6"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate">{{ u.user.displayName }}</p>
          <p class="text-muted truncate">{{ u.user.email }}</p>
        </div>
        <span class="text-muted">{{ new Date(u.usedAt).toLocaleString() }}</span>
      </div>
    </div>
  </div>
</template>
