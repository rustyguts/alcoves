<script setup lang="ts">
import { useRoute } from "vue-router";
import AppIcon from "~/components/AppIcon.vue";

const props = defineProps<{
  libraryId: string;
  faceRecognitionEnabled?: boolean;
  canManageLibrary?: boolean;
}>();

const route = useRoute();

const currentTab = computed(() => {
  if (route.path.endsWith("/tags")) return "tags";
  if (route.path.includes(`/libraries/${props.libraryId}/people`)) return "people";
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
  ];

  if (props.faceRecognitionEnabled) {
    items.push({
      key: "people",
      label: "People",
      icon: "i-lucide-scan-face",
      to: `/libraries/${props.libraryId}/people`,
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
  <div role="tablist" class="tabs tabs-border">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.key"
      role="tab"
      :to="tab.to"
      class="tab gap-1.5"
      :class="currentTab === tab.key ? 'tab-active' : ''"
    >
      <AppIcon :name="tab.icon" class="size-4" />
      <span class="hidden sm:inline">{{ tab.label }}</span>
    </RouterLink>
  </div>
</template>
