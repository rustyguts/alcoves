<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import UserAvatar from "~/components/UserAvatar.vue";
import NotificationBell from "~/components/notifications/NotificationBell.vue";
import SidebarLibraryNav from "~/components/SidebarLibraryNav.vue";
import type { Library } from "~~/shared/types/api";
import type { DropdownMenuItem } from "@nuxt/ui";

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

// Close the mobile slideover whenever the route changes so tapping a sidebar
// link doesn't leave the overlay covering the page.
watch(
  () => route.path,
  () => {
    sidebarOpen.value = false;
  },
);

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
      icon: ICONS.user,
      onSelect: () => router.push("/profile"),
    },
  ],
  [
    {
      label: "Sign out",
      icon: ICONS.signOut,
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
          <SidebarLibraryNav
            class="min-h-0 flex-1"
            :libraries="libraries"
            :user="user"
            @create="createLibrary"
          />
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

      <SidebarLibraryNav
        class="min-h-0 flex-1"
        :libraries="libraries"
        :user="user"
        @create="createLibrary"
      />
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
      <!-- Header -->
      <header
        class="h-16 flex items-center gap-3 px-4 lg:px-6 bg-white dark:bg-neutral-900 border-b border-default shrink-0"
      >
        <UButton
          :icon="ICONS.menu"
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
            :icon="ICONS.search"
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
      <main class="flex-1 min-h-0 overflow-hidden">
        <div class="h-full p-4 sm:p-6 flex flex-col">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
