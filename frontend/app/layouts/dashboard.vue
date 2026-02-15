<script setup lang="ts">
import type { NavigationMenuItem, DropdownMenuItem } from "@nuxt/ui";
import { useRouter, useRoute } from "vue-router";
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";

interface Library {
  id: string;
  name: string;
  isDefault: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

const { user, logout } = useAuth();
const router = useRouter();

const { data: libraries, refresh: refreshLibraries } = useApiFetch<Library[]>("/api/libraries");

const route = useRoute();
const globalSearchQuery = ref("");

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

function getSearchTarget(query: string) {
  if (!query) return { path: "/search" };
  return {
    path: "/search",
    query: { q: query },
  };
}

function submitGlobalSearch() {
  router.push(getSearchTarget(globalSearchQuery.value.trim()));
}

const defaultLibraryItems = computed<NavigationMenuItem[]>(() => {
  const def = libraries.value?.find((l) => l.isDefault);
  if (!def) return [];
  return [
    {
      label: def.name,
      icon: "i-lucide-library",
      to: `/libraries/${def.id}`,
    },
  ];
});

const libraryItems = computed<NavigationMenuItem[]>(() => {
  return (
    libraries.value
      ?.filter((l) => !l.isDefault)
      .map((l) => ({
        label: l.name,
        icon: "i-lucide-folder",
        to: `/libraries/${l.id}`,
      })) ?? []
  );
});

const bottomItems = computed<NavigationMenuItem[]>(() => {
  if (user.value?.role !== "owner") return [];
  return [
    {
      label: "Admin",
      icon: "i-lucide-shield-check",
      to: "/admin",
    },
    {
      label: "Jobs",
      icon: "i-lucide-activity",
      to: "/admin/jobs",
    },
  ];
});

const userMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: "Profile",
      icon: "i-lucide-user",
      to: "/profile",
    },
  ],
  [
    {
      label: "Sign out",
      icon: "i-lucide-log-out",
      onSelect: async (event) => {
        event?.preventDefault();
        await logout();
      },
    },
  ],
]);

async function createLibrary() {
  await apiFetch("/api/libraries", {
    method: "POST",
    body: { name: "Untitled Library" },
  });
  await refreshLibraries();
}

provide("refreshLibraries", refreshLibraries);
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable :ui="{ root: 'max-w-xs' }">
      <template #header="{ collapsed }">
        <span v-if="!collapsed" class="text-lg font-bold truncate">Alcoves</span>
        <UIcon v-else name="i-lucide-layout-dashboard" class="size-5 text-primary mx-auto" />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="defaultLibraryItems"
          orientation="vertical"
        />

        <USeparator />

        <div v-if="!collapsed" class="flex items-center justify-between px-3 pt-1 pb-0.5">
          <span class="text-xs font-semibold text-muted uppercase tracking-wide">Libraries</span>
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            square
            @click="createLibrary"
          />
        </div>
        <UButton
          v-else
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          square
          class="mx-auto"
          @click="createLibrary"
        />

        <UNavigationMenu :collapsed="collapsed" :items="libraryItems" orientation="vertical" />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="bottomItems"
          orientation="vertical"
          class="mt-auto"
        />
      </template>

      <template #footer>
        <UDashboardSidebarCollapse />
      </template>
    </UDashboardSidebar>

    <UDashboardPanel>
      <template #header>
        <UDashboardNavbar>
          <template #left>
            <form class="min-w-0 w-full max-w-2xl" @submit.prevent="submitGlobalSearch">
              <UInput
                v-model="globalSearchQuery"
                type="search"
                autocomplete="off"
                enterkeyhint="search"
                leading-icon="i-lucide-search"
                placeholder="Search"
                variant="soft"
                size="lg"
                class="w-full"
              />
            </form>
          </template>
          <template #right>
            <UDropdownMenu :items="userMenuItems">
              <button
                class="flex items-center gap-2 rounded-full p-1 mr-3 hover:bg-elevated/50 transition-colors"
              >
                <div v-if="user?.avatarUrl" class="size-8 rounded-full overflow-hidden">
                  <img :src="user.avatarUrl" alt="" class="size-full object-cover" />
                </div>
                <div
                  v-else
                  class="size-8 rounded-full bg-primary text-white flex items-center justify-center font-semibold text-sm"
                >
                  {{ user?.displayName?.charAt(0).toUpperCase() ?? "U" }}
                </div>
              </button>
            </UDropdownMenu>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
