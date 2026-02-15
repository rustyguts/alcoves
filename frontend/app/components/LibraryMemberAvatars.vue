<script setup lang="ts">
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

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
</script>

<template>
  <div class="flex items-center gap-2">
    <div class="flex items-center -space-x-2">
      <div
        v-for="member in visibleMembers"
        :key="member.id"
        class="w-6 h-6 rounded-full ring-2 ring-base-100 overflow-hidden flex items-center justify-center bg-neutral text-neutral-content text-xs"
        :title="member.displayName"
      >
        <img
          v-if="member.avatarUrl"
          :src="member.avatarUrl"
          :alt="member.displayName"
          class="w-full h-full object-cover"
        />
        <span v-else>{{ getInitials(member.displayName) }}</span>
      </div>
    </div>

    <details v-if="overflowMembers.length" class="dropdown">
      <summary class="btn btn-xs btn-soft btn-neutral">+{{ overflowMembers.length }}</summary>
      <ul class="dropdown-content menu bg-base-200 rounded-box z-10 w-52 p-2 shadow">
        <li v-for="member in overflowMembers" :key="member.id">
          <a class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center bg-neutral text-neutral-content text-xs shrink-0">
              <img
                v-if="member.avatarUrl"
                :src="member.avatarUrl"
                :alt="member.displayName"
                class="w-full h-full object-cover"
              />
              <span v-else>{{ getInitials(member.displayName) }}</span>
            </div>
            <span>{{ member.displayName }}</span>
          </a>
        </li>
      </ul>
    </details>

    <span v-if="!compact" class="text-xs text-muted">
      {{ members.length }} {{ members.length === 1 ? "member" : "members" }}
    </span>
  </div>
</template>
