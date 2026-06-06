<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import type { LibraryMemberWithUser } from "~~/shared/types/api";
import UserAvatar from "~/components/UserAvatar.vue";

interface RoleOption {
  label: string;
  value: "admin" | "viewer";
}

interface Props {
  member: LibraryMemberWithUser;
  roleDraft: "admin" | "viewer";
  updatingRole: boolean;
  removing: boolean;
  roleOptions: RoleOption[];
}

defineProps<Props>();

const emit = defineEmits<{
  updateRole: [member: LibraryMemberWithUser, role: "admin" | "viewer"];
  remove: [member: LibraryMemberWithUser];
}>();
</script>

<template>
  <div class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3">
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <UserAvatar
        :display-name="member.user.displayName"
        :avatar-url="member.user.avatarUrl"
        size-class="w-8"
      />
      <div class="min-w-0">
        <p class="text-sm font-medium truncate">{{ member.user.displayName }}</p>
        <p class="text-xs text-muted truncate">{{ member.user.email }}</p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <UBadge v-if="member.role === 'owner'" color="primary" variant="soft" size="sm">
        owner
      </UBadge>
      <template v-else>
        <USelect
          :model-value="roleDraft"
          :items="roleOptions"
          :disabled="updatingRole"
          class="w-28"
          @update:model-value="emit('updateRole', member, $event as 'admin' | 'viewer')"
        />
        <UButton
          color="error"
          variant="soft"
          size="sm"
          :icon="ICONS.user"
          square
          :loading="removing"
          :disabled="removing"
          @click="emit('remove', member)"
        />
      </template>
    </div>
  </div>
</template>
