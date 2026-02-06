<script setup lang="ts">
import type { NavigationMenuItem, DropdownMenuItem } from "@nuxt/ui";
import type { Library } from "~~/server/utils/types";

const { data: libraries, refresh: refreshLibraries } = await useFetch<Library[]>("/api/libraries");

const route = useRoute();

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

const bottomItems: NavigationMenuItem[] = [
  {
    label: "Settings",
    icon: "i-lucide-settings",
    to: "/settings",
  },
];

const userMenuItems: DropdownMenuItem[][] = [
  [
    {
      label: "Profile",
      icon: "i-lucide-user",
    },
    {
      label: "Settings",
      icon: "i-lucide-settings",
    },
  ],
  [
    {
      label: "Sign out",
      icon: "i-lucide-log-out",
    },
  ],
];

async function createLibrary() {
  await $fetch("/api/libraries", {
    method: "POST",
    body: { name: "Untitled Library" },
  });
  await refreshLibraries();
}

provide("refreshLibraries", refreshLibraries);

const navbarTitle = computed(() => {
  const id = route.params.id as string | undefined;
  if (!id || !libraries.value) return "Dashboard";
  const lib = libraries.value.find((l) => l.id === id);
  return lib?.name ?? "Dashboard";
});
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable :ui="{ footer: 'border-t border-default' }">
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
        <UDashboardNavbar :title="navbarTitle">
          <template #right>
            <UDropdownMenu :items="userMenuItems">
              <UButton
                icon="i-lucide-user"
                color="neutral"
                variant="ghost"
                label="John Doe"
                trailing-icon="i-lucide-chevron-down"
              />
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
