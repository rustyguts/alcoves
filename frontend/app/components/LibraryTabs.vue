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

interface Tab {
  key: string;
  label: string;
  icon: string;
  to: string;
}

// Browse tabs: the content sections, shown with icon + label on the left.
const browseTabs = computed<Tab[]>(() => {
  const items: Tab[] = [
    { key: "files", label: "Files", icon: "i-lucide-folder", to: `/libraries/${props.libraryId}` },
    { key: "tags", label: "Tags", icon: "i-lucide-tags", to: `/libraries/${props.libraryId}/tags` },
    { key: "feed", label: "Feed", icon: "i-lucide-rss", to: `/libraries/${props.libraryId}/feed` },
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

  return items;
});

// Utility tabs: management surfaces, de-emphasised as icon-only on the right.
const utilityTabs = computed<Tab[]>(() => {
  const items: Tab[] = [
    { key: "trash", label: "Trash", icon: "i-lucide-trash-2", to: `/libraries/${props.libraryId}/trash` },
  ];

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
  <div role="tablist" class="flex items-stretch gap-2 border-b border-default">
    <!-- Browse tabs: icon + label (label hidden on mobile), horizontal scroll -->
    <div
      class="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <NuxtLink
        v-for="tab in browseTabs"
        :key="tab.key"
        role="tab"
        :to="tab.to"
        :aria-label="tab.label"
        :title="tab.label"
        class="-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4"
        :class="
          currentTab === tab.key
            ? 'border-primary text-primary'
            : 'border-transparent text-muted hover:border-default hover:text-default'
        "
        @click="onTabClick(tab.to, $event)"
      >
        <AppIcon :name="tab.icon" class="size-4 shrink-0" />
        <span class="hidden sm:inline">{{ tab.label }}</span>
      </NuxtLink>
    </div>

    <!-- Utility tabs: icon-only, de-emphasised, pinned right -->
    <div class="flex shrink-0 items-stretch">
      <UTooltip v-for="tab in utilityTabs" :key="tab.key" :text="tab.label">
        <NuxtLink
          role="tab"
          :to="tab.to"
          :aria-label="tab.label"
          :title="tab.label"
          class="-mb-px inline-flex items-center border-b-2 px-2.5 py-2.5 transition-colors"
          :class="
            currentTab === tab.key
              ? 'border-primary text-primary'
              : 'border-transparent text-dimmed hover:border-default hover:text-default'
          "
          @click="onTabClick(tab.to, $event)"
        >
          <AppIcon :name="tab.icon" class="size-4 shrink-0" />
        </NuxtLink>
      </UTooltip>
      <slot name="actions" />
    </div>
  </div>
</template>
