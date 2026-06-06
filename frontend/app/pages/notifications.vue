<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { onMounted, onBeforeUnmount } from "vue";
import { useNotifications } from "~/composables/useNotifications";
import { useNotificationsSocket } from "~/composables/useNotificationsSocket";
import { groupActivities } from "~/utils/activity-format";
import NotificationItem from "~/components/notifications/NotificationItem.vue";
import AppIcon from "~/components/AppIcon.vue";

definePageMeta({ layout: "dashboard" });

const router = useRouter();
const noti = useNotifications();
const socket = useNotificationsSocket();

let unsubscribe: (() => void) | null = null;

onMounted(async () => {
  await noti.loadFirst();
  socket.connect();
  unsubscribe = socket.onActivity((activity) => {
    noti.prependLive(activity);
  });
});

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe();
});

// Group by library, then by time-bucket inside each library.
const groupedByLibrary = computed(() => {
  const byLib = new Map<string, typeof noti.entries.value>();
  for (const e of noti.entries.value) {
    const arr = byLib.get(e.libraryId) ?? [];
    arr.push(e);
    byLib.set(e.libraryId, arr);
  }
  const out: { libraryId: string; libraryName: string; groups: ReturnType<typeof groupActivities> }[] = [];
  for (const [libId, rows] of byLib) {
    out.push({
      libraryId: libId,
      libraryName: rows[0]?.libraryName ?? "",
      groups: groupActivities(rows),
    });
  }
  return out;
});

function onNavigate(href: string) {
  router.push(href);
}

function onDismiss(ids: string[]) {
  for (const id of ids) noti.dismiss(id);
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="px-4 py-3 border-b border-default flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold text-default">Notifications</h1>
        <p class="text-xs text-muted mt-0.5">Activity across all your libraries.</p>
      </div>
      <button
        v-if="noti.entries.value.length > 0"
        type="button"
        class="text-sm text-muted hover:text-default underline"
        @click="noti.dismissAll()"
      >
        Dismiss all
      </button>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="noti.loading.value && noti.entries.value.length === 0" class="px-4 py-8 text-center text-sm text-muted">
        <AppIcon :name="ICONS.loading" class="size-5 animate-spin inline-block" />
        <p class="mt-2">Loading…</p>
      </div>
      <div v-else-if="noti.entries.value.length === 0" class="px-4 py-12 text-center text-sm text-muted">
        You're all caught up.
      </div>
      <div v-else>
        <section v-for="lib in groupedByLibrary" :key="lib.libraryId" class="border-b border-default">
          <header class="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {{ lib.libraryName }}
          </header>
          <div class="divide-y divide-default">
            <NotificationItem
              v-for="g in lib.groups"
              :key="g.head.id"
              :group="g"
              :show-library-name="false"
              :show-dismiss="true"
              @dismiss="onDismiss"
              @navigate="onNavigate"
            />
          </div>
        </section>
      </div>
      <div v-if="noti.nextCursor.value" class="px-4 py-4 text-center">
        <button
          type="button"
          class="text-sm text-primary hover:underline"
          :disabled="noti.loadingMore.value"
          @click="noti.loadMore()"
        >
          {{ noti.loadingMore.value ? "Loading…" : "Load older" }}
        </button>
      </div>
    </div>
  </div>
</template>
