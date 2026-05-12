<script setup lang="ts">
import AppIcon from "~/components/AppIcon.vue";

const props = defineProps<{
  libraryId: string;
  faceRecognitionEnabled?: boolean;
  objectDetectionEnabled?: boolean;
  canManageLibrary?: boolean;
}>();

const route = useRoute();
const router = useRouter();

// `/libraries/:id/trash` is registered as an alias of `/libraries/:id`, so
// vue-router considers same-record navigation a no-op. Force a push so the
// URL flips between Files and Trash even though both share the same page.
function onTabClick(to: string, event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  router.push({ path: to, force: true });
}

const currentTab = computed(() => {
  if (route.path.endsWith("/tags")) return "tags";
  if (route.path.endsWith("/feed")) return "feed";
  if (route.path.includes(`/libraries/${props.libraryId}/people`)) return "people";
  if (route.path.endsWith("/objects")) return "objects";
  if (route.path.endsWith("/settings")) return "settings";
  if (route.path.endsWith("/trash")) return "trash";
  return "files";
});

const tabs = computed(() => {
  const items = [
    {
      key: "files",
      label: "Files",
      icon: "i-lucide-folder",
      to: `/libraries/${props.libraryId}`,
    },
    {
      key: "tags",
      label: "Tags",
      icon: "i-lucide-tags",
      to: `/libraries/${props.libraryId}/tags`,
    },
    {
      key: "feed",
      label: "Feed",
      icon: "i-lucide-rss",
      to: `/libraries/${props.libraryId}/feed`,
    },
  ];

  if (props.faceRecognitionEnabled) {
    items.push({
      key: "people",
      label: "People",
      icon: "i-lucide-scan-face",
      to: `/libraries/${props.libraryId}/people`,
    });
  }

  if (props.objectDetectionEnabled) {
    items.push({
      key: "objects",
      label: "Objects",
      icon: "i-lucide-scan-search",
      to: `/libraries/${props.libraryId}/objects`,
    });
  }

  items.push({
    key: "trash",
    label: "Trash",
    icon: "i-lucide-trash-2",
    to: `/libraries/${props.libraryId}/trash`,
  });

  if (props.canManageLibrary) {
    items.push({
      key: "settings",
      label: "Settings",
      icon: "i-lucide-settings",
      to: `/libraries/${props.libraryId}/settings`,
    });
  }

  return items;
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div
      role="tablist"
      class="flex flex-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-default [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.key"
        role="tab"
        :to="tab.to"
        class="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="
          currentTab === tab.key
            ? 'border-primary text-primary'
            : 'border-transparent text-muted hover:text-default hover:border-default'
        "
        @click="onTabClick(tab.to, $event)"
      >
        <AppIcon :name="tab.icon" class="size-4" />
        <span class="hidden sm:inline">{{ tab.label }}</span>
      </NuxtLink>
    </div>
    <div class="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto">
      <slot name="actions" />
    </div>
  </div>
</template>
