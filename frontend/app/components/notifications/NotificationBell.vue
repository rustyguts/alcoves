<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { ref, onMounted } from "vue";
import AppIcon from "~/components/AppIcon.vue";
import { useNotifications } from "~/composables/useNotifications";
import { useNotificationsSocket } from "~/composables/useNotificationsSocket";
import NotificationDropdown from "./NotificationDropdown.vue";

const open = ref(false);
const noti = useNotifications();
const socket = useNotificationsSocket();

onMounted(() => {
  // Connect WS + wire incoming activity into the global notifications state.
  socket.connect();
  socket.onActivity((activity) => {
    if (!activity?.id) return;
    noti.prependLive(activity);
  });
  // Initial unread count for the badge.
  noti.refreshUnreadCount().catch(() => {});
});

const badgeText = computed(() => {
  const n = noti.unreadCount.value;
  if (n <= 0) return null;
  return n > 99 ? "99+" : String(n);
});
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end', sideOffset: 8 }">
    <UButton color="neutral" variant="ghost" square aria-label="Notifications" class="relative p-1">
      <AppIcon :name="ICONS.bell" class="size-5" />
      <span
        v-if="badgeText"
        class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full bg-primary text-white text-[10px] font-semibold leading-4 text-center"
      >
        {{ badgeText }}
      </span>
    </UButton>
    <template #content>
      <NotificationDropdown @close="open = false" />
    </template>
  </UPopover>
</template>
