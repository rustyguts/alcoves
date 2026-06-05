<script setup lang="ts">
import AppIcon from "~/components/AppIcon.vue";
import UserAvatar from "~/components/UserAvatar.vue";
import { formatActivity, relativeTime, type ActivityGroup } from "~/utils/activity-format";

const props = defineProps<{
  group: ActivityGroup;
  showLibraryName?: boolean;
  showDismiss?: boolean;
}>();

const emit = defineEmits<{ dismiss: [ids: string[]]; navigate: [href: string] }>();

const formatted = computed(() => formatActivity(props.group));
const time = computed(() => relativeTime(props.group.head.createdAt));
const idsInGroup = computed(() => props.group.items.map((i) => i.id));

function onClick(event: MouseEvent) {
  if (formatted.value.href) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return; // let browser handle
    event.preventDefault();
    emit("navigate", formatted.value.href);
  }
}

function onDismiss(event: MouseEvent) {
  event.stopPropagation();
  event.preventDefault();
  emit("dismiss", idsInGroup.value);
}
</script>

<template>
  <component
    :is="formatted.href ? 'a' : 'div'"
    :href="formatted.href ?? undefined"
    class="flex items-start gap-3 px-3 py-2.5 hover:bg-elevated/60 transition-colors cursor-pointer group"
    @click="onClick"
  >
    <div class="shrink-0 mt-0.5">
      <UserAvatar
        v-if="group.head.actor"
        :display-name="group.head.actor.displayName"
        :avatar-url="group.head.actor.avatarUrl"
        size-class="w-7"
      />
      <div
        v-else
        class="size-7 rounded-full bg-elevated flex items-center justify-center text-muted"
      >
        <AppIcon :name="formatted.icon" class="size-4" />
      </div>
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-1.5">
        <AppIcon :name="formatted.icon" class="size-3.5 shrink-0 text-muted" />
        <p class="text-sm text-default truncate">{{ formatted.text }}</p>
      </div>
      <p class="mt-0.5 text-xs text-muted">
        <span v-if="showLibraryName && group.head.libraryName">{{ group.head.libraryName }} · </span>{{ time }}
      </p>
    </div>
    <button
      v-if="showDismiss"
      type="button"
      class="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-default p-1 -m-1"
      aria-label="Dismiss notification"
      @click="onDismiss"
    >
      <AppIcon name="i-lineicons-x" class="size-4" />
    </button>
  </component>
</template>
