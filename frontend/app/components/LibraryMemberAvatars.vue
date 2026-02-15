<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";

interface MemberAvatar {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

const props = withDefaults(
  defineProps<{
    members: MemberAvatar[];
    maxVisible?: number;
    compact?: boolean;
  }>(),
  {
    maxVisible: 5,
    compact: false,
  },
);

const visibleMembers = computed(() => props.members.slice(0, props.maxVisible));
const overflowMembers = computed(() => props.members.slice(props.maxVisible));

const overflowItems = computed<DropdownMenuItem[][]>(() => [
  overflowMembers.value.map((member) => ({
    label: member.displayName,
    avatar: {
      src: member.avatarUrl ?? undefined,
      alt: member.displayName,
    },
  })),
]);
</script>

<template>
  <div class="flex items-center gap-2">
    <div class="flex items-center -space-x-2">
      <UAvatar
        v-for="member in visibleMembers"
        :key="member.id"
        :src="member.avatarUrl ?? undefined"
        :alt="member.displayName"
        size="xs"
        class="ring-2 ring-(--ui-bg)"
        :title="member.displayName"
      />
    </div>

    <UDropdownMenu v-if="overflowMembers.length" :items="overflowItems">
      <UButton :label="`+${overflowMembers.length}`" size="xs" color="neutral" variant="soft" />
    </UDropdownMenu>

    <span v-if="!compact" class="text-xs text-muted">
      {{ members.length }} {{ members.length === 1 ? "member" : "members" }}
    </span>
  </div>
</template>
