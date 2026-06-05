<script setup lang="ts">
import type { AuthUser, Library } from "~~/shared/types/api";
import type { NavigationMenuItem } from "@nuxt/ui";

/**
 * The library navigation that lives in the app sidebar. Each library is a
 * collapsible group; the active library expands to reveal its sections
 * (Files / Timeline / Map / Tags / Feed / People / Objects / Settings / Trash)
 * as nested items. Clicking a library name navigates to its Files and opens it,
 * so switching libraries — and jumping to any of a library's tabs — is one
 * click from anywhere. Shared between the desktop sidebar and the mobile
 * slideover so both stay in sync.
 */
const props = defineProps<{
  libraries: Library[] | null;
  user: AuthUser | null;
}>();

const emit = defineEmits<{ create: [] }>();

const route = useRoute();
const router = useRouter();

function libBase(id: string): string {
  return `/libraries/${id}`;
}

function isActiveLibrary(id: string): boolean {
  const base = libBase(id);
  return route.path === base || route.path.startsWith(`${base}/`);
}

const activeLibraryId = computed(() => {
  for (const l of props.libraries ?? []) {
    if (isActiveLibrary(l.id)) return l.id;
  }
  return null;
});

// Mirror of LibraryTabs' route → tab-key detection, scoped to the active library.
function activeTabKey(id: string): string | null {
  if (activeLibraryId.value !== id) return null;
  const p = route.path;
  if (p.endsWith("/timeline")) return "timeline";
  if (p.endsWith("/map")) return "map";
  if (p.endsWith("/tags")) return "tags";
  if (p.endsWith("/feed")) return "feed";
  if (p.includes(`${libBase(id)}/people`)) return "people";
  if (p.endsWith("/objects")) return "objects";
  if (p.endsWith("/settings")) return "settings";
  if (p.endsWith("/trash")) return "trash";
  return "files";
}

function canManage(l: Library): boolean {
  if (l.ownerId && props.user?.id && l.ownerId === props.user.id) return true;
  return l.currentUserRole === "owner" || l.currentUserRole === "admin";
}

// `/libraries/:id/trash` is an alias of `/libraries/:id`, so vue-router treats
// navigating between Files and Trash as a same-record no-op. Force the push so
// the URL (and active tab) actually flips.
function forceNav(to: string) {
  return (e: Event) => {
    e.preventDefault();
    router.push({ path: to, force: true });
  };
}

function tabChildren(l: Library): NavigationMenuItem[] {
  const base = libBase(l.id);
  const active = activeTabKey(l.id);
  const items: NavigationMenuItem[] = [
    {
      label: "Files",
      icon: "i-lucide-folder",
      to: base,
      active: active === "files",
      onSelect: forceNav(base),
    },
    { label: "Timeline", icon: "i-lucide-clock", to: `${base}/timeline`, active: active === "timeline" },
    { label: "Map", icon: "i-lucide-map-pin", to: `${base}/map`, active: active === "map" },
    { label: "Tags", icon: "i-lucide-tags", to: `${base}/tags`, active: active === "tags" },
    { label: "Feed", icon: "i-lucide-rss", to: `${base}/feed`, active: active === "feed" },
  ];

  if (l.faceRecognitionEnabled) {
    items.push({
      label: "People",
      icon: "i-lucide-scan-face",
      to: `${base}/people`,
      active: active === "people",
    });
  }

  if (l.objectDetectionEnabled) {
    items.push({
      label: "Objects",
      icon: "i-lucide-scan-search",
      to: `${base}/objects`,
      active: active === "objects",
    });
  }

  if (canManage(l)) {
    items.push({
      label: "Settings",
      icon: "i-lucide-settings",
      to: `${base}/settings`,
      active: active === "settings",
    });
  }

  items.push({
    label: "Trash",
    icon: "i-lucide-trash-2",
    to: `${base}/trash`,
    active: active === "trash",
    onSelect: forceNav(`${base}/trash`),
  });

  return items;
}

function libraryItem(l: Library): NavigationMenuItem {
  const base = libBase(l.id);
  const open = isActiveLibrary(l.id);
  return {
    label: l.emoji ? `${l.emoji}  ${l.name}` : l.name,
    icon: l.emoji ? undefined : l.isDefault ? "i-lucide-library" : "i-lucide-folder",
    to: base,
    type: "trigger",
    active: open,
    defaultOpen: open,
    children: tabChildren(l),
    onSelect: forceNav(base),
  };
}

const defaultLibraryItems = computed<NavigationMenuItem[]>(() => {
  const def = props.libraries?.find((l) => l.isDefault);
  return def ? [libraryItem(def)] : [];
});

const libraryItems = computed<NavigationMenuItem[]>(
  () => props.libraries?.filter((l) => !l.isDefault).map(libraryItem) ?? [],
);

const bottomItems = computed<NavigationMenuItem[]>(() => {
  if (props.user?.role !== "owner") return [];
  return [
    {
      label: "Admin",
      icon: "i-lucide-shield-check",
      to: "/admin",
      active: route.path === "/admin" || route.path.startsWith("/admin/"),
    },
  ];
});

// `defaultOpen` only seeds the accordion's initial state, so remount the menus
// when the active library changes to re-open the new one and collapse the old.
const navKey = computed(() => activeLibraryId.value ?? "none");
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div v-if="defaultLibraryItems.length" class="px-2">
      <UNavigationMenu
        :key="`default-${navKey}`"
        orientation="vertical"
        :items="defaultLibraryItems"
        variant="pill"
        class="w-full"
      />
    </div>

    <USeparator class="my-2" />

    <div class="flex items-center justify-between px-5 pt-1 pb-2">
      <span class="text-xs font-semibold text-muted uppercase tracking-wide">Libraries</span>
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        square
        aria-label="Create library"
        @click="emit('create')"
      />
    </div>

    <div class="px-2 flex-1 overflow-y-auto">
      <UNavigationMenu
        :key="`libs-${navKey}`"
        orientation="vertical"
        :items="libraryItems"
        variant="pill"
        class="w-full"
      />
    </div>

    <div v-if="bottomItems.length" class="px-2 pb-3 mt-auto">
      <USeparator class="mb-2" />
      <UNavigationMenu orientation="vertical" :items="bottomItems" variant="pill" class="w-full" />
    </div>
  </div>
</template>
