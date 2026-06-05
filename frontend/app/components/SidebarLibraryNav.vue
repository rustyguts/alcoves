<script setup lang="ts">
import type { AuthUser, Library } from "~~/shared/types/api";
import type { NavigationMenuItem } from "@nuxt/ui";
import LibrarySwitcher from "~/components/LibrarySwitcher.vue";

/**
 * The sidebar library region: a library switcher (account-switcher style) at the
 * top, then a divider, then the current library's actions/sections (Files,
 * Timeline, Map, Tags, Feed, People, Objects, Settings, Trash) as a static nav.
 * The actions always target the active library (or the default library when no
 * library is open). Shared between the desktop sidebar and the mobile slideover.
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

// The library whose actions the sidebar shows: the one open in the route, else
// the default library, else the first available.
const currentLibrary = computed(() => {
  const libs = props.libraries ?? [];
  return (
    libs.find((l) => isActiveLibrary(l.id)) ??
    libs.find((l) => l.isDefault) ??
    libs[0] ??
    null
  );
});

function activeTabKey(id: string): string | null {
  if (!isActiveLibrary(id)) return null;
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
// navigating between Files and Trash as a same-record no-op. Force the push.
function forceNav(to: string) {
  return (e: Event) => {
    e.preventDefault();
    router.push({ path: to, force: true });
  };
}

const actionItems = computed<NavigationMenuItem[]>(() => {
  const l = currentLibrary.value;
  if (!l) return [];
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
});

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

// Larger, more generously spaced sidebar items: bigger tap target + label, a
// roomier icon, and vertical breathing room between entries.
const navUi = {
  list: "gap-1",
  link: "px-3 py-2.5 text-base gap-3",
  linkLeadingIcon: "size-5",
};
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="px-2 pt-1">
      <LibrarySwitcher
        :libraries="libraries"
        :current-library-id="currentLibrary?.id ?? null"
        @create="emit('create')"
      />
    </div>

    <USeparator class="my-2" />

    <div class="px-2 flex-1 overflow-y-auto">
      <UNavigationMenu
        orientation="vertical"
        :items="actionItems"
        variant="pill"
        class="w-full"
        :ui="navUi"
      />
    </div>

    <div v-if="bottomItems.length" class="px-2 pb-3 mt-auto">
      <USeparator class="mb-2" />
      <UNavigationMenu
        orientation="vertical"
        :items="bottomItems"
        variant="pill"
        class="w-full"
        :ui="navUi"
      />
    </div>
  </div>
</template>
