<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "#app/composables/router";
import { useNotifications } from "~/composables/useNotifications";
import { groupActivities } from "~/utils/activity-format";
import NotificationItem from "./NotificationItem.vue";

const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const noti = useNotifications();

onMounted(() => {
  if (noti.entries.value.length === 0) {
    noti.loadFirst();
  }
});

const groups = computed(() => groupActivities(noti.entries.value).slice(0, 20));
const hasMore = computed(() => noti.entries.value.length > 20 || noti.nextCursor.value !== null);

function onDismiss(ids: string[]) {
  for (const id of ids) noti.dismiss(id);
}

async function onDismissAll() {
  await noti.dismissAll();
}

function onNavigate(href: string) {
  router.push(href);
  emit("close");
}

function viewAll() {
  router.push("/notifications");
  emit("close");
}
</script>

<template>
  <div class="w-96 max-w-[90vw] flex flex-col">
    <div class="flex items-center justify-between px-4 py-2.5 border-b border-default">
      <h3 class="text-sm font-semibold text-default">Notifications</h3>
      <button
        v-if="noti.entries.value.length > 0"
        type="button"
        class="text-xs text-muted hover:text-default underline"
        @click="onDismissAll"
      >
        Dismiss all
      </button>
    </div>
    <div class="max-h-96 overflow-y-auto">
      <div v-if="noti.loading.value && noti.entries.value.length === 0" class="px-4 py-6 text-center text-sm text-muted">
        Loading…
      </div>
      <div v-else-if="noti.entries.value.length === 0" class="px-4 py-6 text-center text-sm text-muted">
        You're all caught up.
      </div>
      <NotificationItem
        v-for="g in groups"
        :key="g.head.id"
        :group="g"
        :show-library-name="true"
        :show-dismiss="true"
        @dismiss="onDismiss"
        @navigate="onNavigate"
      />
    </div>
    <button
      v-if="hasMore"
      type="button"
      class="px-4 py-2 text-sm text-primary hover:bg-elevated/60 border-t border-default text-center"
      @click="viewAll"
    >
      See all notifications
    </button>
  </div>
</template>
