<script setup lang="ts">
import type { BreadcrumbItem } from "@nuxt/ui";
import { useLibraryFolderPath } from "~/composables/useLibraryFolderPath";

/**
 * The library page's primary heading: a breadcrumb whose root is the library
 * name (links to the Files root) and whose tail is the current folder ancestry
 * (only present on the Files tab, via `useLibraryFolderPath`). No leading home
 * icon — the library name is the anchor. The current crumb is rendered by
 * `UBreadcrumb` as the non-link "current page" and styled as the heading.
 */
const props = defineProps<{
  libraryId: string;
  libraryName?: string;
}>();

const folderPath = useLibraryFolderPath();

const items = computed<BreadcrumbItem[]>(() => {
  const base = `/libraries/${props.libraryId}`;
  const crumbs: BreadcrumbItem[] = [
    { label: props.libraryName || "Library", to: base },
    ...folderPath.value.map((crumb) => ({
      label: crumb.name,
      to: `${base}?folder=${encodeURIComponent(crumb.id)}`,
    })),
  ];
  // Emphasise the current (last) crumb so the breadcrumb reads as the heading.
  const lastIndex = crumbs.length - 1;
  return crumbs.map((item, index) =>
    index === lastIndex ? { ...item, class: "text-highlighted font-semibold" } : item,
  );
});
</script>

<template>
  <UBreadcrumb
    :items="items"
    :ui="{
      root: 'min-w-0',
      list: 'flex-nowrap',
      item: 'min-w-0',
      link: 'min-w-0 text-lg sm:text-xl font-medium',
      linkLabel: 'truncate max-w-[7rem] sm:max-w-xs',
      separator: 'mx-1 sm:mx-1.5',
      separatorIcon: 'size-4 sm:size-5',
    }"
  />
</template>
