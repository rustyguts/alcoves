<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import UserAvatar from "~/components/UserAvatar.vue";
import NotificationBell from "~/components/notifications/NotificationBell.vue";
import type { Library } from "~~/shared/types/api";
import type { DropdownMenuItem, NavigationMenuItem } from "@nuxt/ui";

const { user, logout } = useAuth();
const router = useRouter();
const route = useRoute();

const { data: libraries, refresh: refreshLibraries } = useApiFetch<Library[]>("/api/libraries");
const { register } = useLibrariesList();
register(refreshLibraries);

const globalSearchQuery = ref("");
const sidebarOpen = ref(false);

const routeSearchQuery = computed(() => {
  const raw = route.query.q;
  return typeof raw === "string" ? raw : "";
});

watch(
  routeSearchQuery,
  (value) => {
    globalSearchQuery.value = value;
  },
  { immediate: true },
);

function submitGlobalSearch() {
  const q = globalSearchQuery.value.trim();
  router.push(q ? { path: "/search", query: { q } } : { path: "/search" });
}

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(`${to}/`);
}

const defaultLibraryItems = computed<NavigationMenuItem[]>(() => {
  const def = libraries.value?.find((l) => l.isDefault);
  if (!def) return [];
  const to = `/libraries/${def.id}`;
  return [
    {
      label: def.emoji ? `${def.emoji}  ${def.name}` : def.name,
      icon: def.emoji ? undefined : "i-lucide-library",
      to,
      active: isActive(to),
    },
  ];
});

const libraryItems = computed<NavigationMenuItem[]>(() => {
  return (
    libraries.value
      ?.filter((l) => !l.isDefault)
      .map((l) => {
        const to = `/libraries/${l.id}`;
        return {
          label: l.emoji ? `${l.emoji}  ${l.name}` : l.name,
          icon: l.emoji ? undefined : "i-lucide-folder",
          to,
          active: isActive(to),
        };
      }) ?? []
  );
});

const bottomItems = computed<NavigationMenuItem[]>(() => {
  if (user.value?.role !== "owner") return [];
  return [
    {
      label: "Admin",
      icon: "i-lucide-shield-check",
      to: "/admin",
      active: isActive("/admin"),
    },
  ];
});

const userMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: user.value?.displayName ?? "User",
      avatar: {
        src: user.value?.avatarUrl ? apiUrl(user.value.avatarUrl) : undefined,
        text: user.value?.displayName?.charAt(0).toUpperCase() ?? "U",
      },
      type: "label",
    },
  ],
  [
    {
      label: "Profile",
      icon: "i-lucide-user",
      onSelect: () => router.push("/profile"),
    },
  ],
  [
    {
      label: "Sign out",
      icon: "i-lucide-log-out",
      color: "error",
      onSelect: async () => {
        await logout();
      },
    },
  ],
]);

async function createLibrary() {
  await api.libraries.create({ name: "Untitled Library" });
  await refreshLibraries();
}
</script>

<template>
  <div class="h-screen flex overflow-hidden bg-neutral-50 dark:bg-neutral-950">
    <!-- Mobile sidebar slideover -->
    <USlideover v-model:open="sidebarOpen" side="left" :ui="{ content: 'w-72' }">
      <template #content>
        <aside
          class="flex h-full w-full flex-col bg-white dark:bg-neutral-900 border-r border-default"
        >
          <NuxtLink to="/" class="block px-5 py-4" @click="sidebarOpen = false">
            <div class="flex items-center gap-3">
              <img src="/logo.webp" alt="Alcoves" width="32" height="32" class="rounded-lg" />
              <span class="text-lg font-bold tracking-tight">Alcoves</span>
            </div>
          </NuxtLink>
          <div class="px-2">
            <UNavigationMenu
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
              @click="createLibrary"
            />
          </div>
          <div class="px-2 flex-1 overflow-y-auto">
            <UNavigationMenu
              orientation="vertical"
              :items="libraryItems"
              variant="pill"
              class="w-full"
            />
          </div>
          <div v-if="bottomItems.length" class="px-2 pb-3 mt-auto">
            <USeparator class="mb-2" />
            <UNavigationMenu
              orientation="vertical"
              :items="bottomItems"
              variant="pill"
              class="w-full"
            />
          </div>
        </aside>
      </template>
    </USlideover>

    <!-- Desktop sidebar -->
    <aside
      class="hidden lg:flex h-full w-64 flex-col bg-white dark:bg-neutral-900 border-r border-default overflow-hidden"
    >
      <NuxtLink to="/" class="block px-5 py-4">
        <div class="flex items-center gap-3">
          <img src="/logo.webp" alt="Alcoves" width="32" height="32" class="rounded-lg" />
          <span class="text-lg font-bold tracking-tight">Alcoves</span>
        </div>
      </NuxtLink>

      <div class="px-2">
        <UNavigationMenu
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
          @click="createLibrary"
        />
      </div>

      <div class="px-2 flex-1 overflow-y-auto">
        <UNavigationMenu
          orientation="vertical"
          :items="libraryItems"
          variant="pill"
          class="w-full"
        />
      </div>

      <div v-if="bottomItems.length" class="px-2 pb-3 mt-auto">
        <USeparator class="mb-2" />
        <UNavigationMenu
          orientation="vertical"
          :items="bottomItems"
          variant="pill"
          class="w-full"
        />
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
      <!-- Header -->
      <header
        class="h-16 flex items-center gap-3 px-4 lg:px-6 bg-white dark:bg-neutral-900 border-b border-default shrink-0"
      >
        <UButton
          icon="i-lucide-menu"
          color="neutral"
          variant="ghost"
          square
          class="lg:hidden"
          aria-label="Open sidebar"
          @click="sidebarOpen = true"
        />
        <form class="flex-1 max-w-lg" @submit.prevent="submitGlobalSearch">
          <UInput
            v-model="globalSearchQuery"
            icon="i-lucide-search"
            placeholder="Search everything…"
            type="search"
            size="md"
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
        </form>
        <div class="flex-1" />
        <NotificationBell />
        <UDropdownMenu
          :items="userMenuItems"
          :content="{ align: 'end', sideOffset: 8 }"
          :ui="{ content: 'w-56' }"
        >
          <UButton color="neutral" variant="ghost" square aria-label="User menu" class="p-1">
            <UserAvatar
              :display-name="user?.displayName ?? 'User'"
              :avatar-url="user?.avatarUrl ?? null"
              size-class="w-8"
            />
          </UButton>
        </UDropdownMenu>
      </header>

      <!-- Page content -->
      <div class="flex-1 min-h-0 overflow-hidden">
        <div class="h-full p-4 sm:p-6 flex flex-col">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>
