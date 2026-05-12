<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useLibraryFeed } from "~/composables/useLibraryFeed";
import { useNotificationsSocket } from "~/composables/useNotificationsSocket";
import { groupActivities } from "~/utils/activity-format";
import NotificationItem from "~/components/notifications/NotificationItem.vue";
import AppIcon from "~/components/AppIcon.vue";

definePageMeta({ layout: "library" });

const route = useRoute();
const router = useRouter();
const libraryId = computed(() => route.params.id as string);

const feed = useLibraryFeed(libraryId);
const socket = useNotificationsSocket();

let unsubscribe: (() => void) | null = null;
let room = "";

onMounted(async () => {
  await feed.loadFirst();
  socket.connect();
  room = `library:${libraryId.value}`;
  socket.subscribeRoom(room);
  unsubscribe = socket.onActivity((activity) => {
    if (activity.libraryId === libraryId.value) {
      feed.prependLive(activity);
    }
  });
});

onBeforeUnmount(() => {
  if (room) socket.unsubscribeRoom(room);
  if (unsubscribe) unsubscribe();
});

const groups = computed(() => groupActivities(feed.entries.value));

function onNavigate(href: string) {
  router.push(href);
}

function onDismiss() {
  // Library feed has no dismiss state; this never fires because the
  // NotificationItem isn't given show-dismiss. Kept here for type safety.
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="px-4 py-3 border-b border-default">
      <h2 class="text-base font-semibold text-default">Activity feed</h2>
      <p class="text-xs text-muted mt-0.5">Everything that has happened in this library.</p>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="feed.loading.value && feed.entries.value.length === 0" class="px-4 py-8 text-center text-sm text-muted">
        <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin inline-block" />
        <p class="mt-2">Loading…</p>
      </div>
      <div v-else-if="feed.entries.value.length === 0" class="px-4 py-12 text-center text-sm text-muted">
        No activity yet.
      </div>
      <div v-else class="divide-y divide-default">
        <NotificationItem
          v-for="g in groups"
          :key="g.head.id"
          :group="g"
          :show-library-name="false"
          :show-dismiss="false"
          @dismiss="onDismiss"
          @navigate="onNavigate"
        />
      </div>
      <div v-if="feed.nextCursor.value" class="px-4 py-4 text-center">
        <button
          type="button"
          class="text-sm text-primary hover:underline"
          :disabled="feed.loadingMore.value"
          @click="feed.loadMore()"
        >
          {{ feed.loadingMore.value ? "Loading…" : "Load older" }}
        </button>
      </div>
    </div>
  </div>
</template>
