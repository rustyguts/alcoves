<script setup lang="ts">
import type { LibraryMemberWithUser } from "~~/shared/types/api";
import AppIcon from "~/components/AppIcon.vue";
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
      <span v-if="member.role === 'owner'" class="badge badge-sm badge-primary">owner</span>
      <template v-else>
        <select
          :value="roleDraft"
          class="select w-28"
          :disabled="updatingRole"
          @change="
            emit(
              'updateRole',
              member,
              ($event.target as HTMLSelectElement).value as 'admin' | 'viewer',
            )
          "
        >
          <option v-for="item in roleOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
        <button
          class="btn btn-sm btn-error btn-soft"
          :disabled="removing"
          @click="emit('remove', member)"
        >
          <span v-if="removing" class="loading loading-spinner loading-xs"></span>
          <AppIcon v-else name="i-lucide-user-minus" class="size-4" />
        </button>
      </template>
    </div>
  </div>
</template>
