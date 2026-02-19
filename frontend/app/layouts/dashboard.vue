<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";
import AppIcon from "~/components/AppIcon.vue";
import UserAvatar from "~/components/UserAvatar.vue";
import { useToast } from "~/composables/useToast";

interface Library {
  id: string;
  name: string;
  emoji: string | null;
  isDefault: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

interface NavItem {
  label: string;
  icon: string;
  emoji?: string | null;
  to: string;
}

interface MenuAction {
  label: string;
  icon: string;
  to?: string;
  onSelect?: (event?: Event) => void;
}

const { user, logout } = useAuth();
const router = useRouter();

const { data: libraries, refresh: refreshLibraries } = useApiFetch<Library[]>("/api/libraries");

const route = useRoute();
const globalSearchQuery = ref("");
const userMenuOpen = ref(false);
const userMenuRef = ref<HTMLElement | null>(null);

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

const defaultLibraryItems = computed<NavItem[]>(() => {
  const def = libraries.value?.find((l) => l.isDefault);
  if (!def) return [];
  return [
    {
      label: def.name,
      icon: "i-lucide-library",
      emoji: def.emoji,
      to: `/libraries/${def.id}`,
    },
  ];
});

const libraryItems = computed<NavItem[]>(() => {
  return (
    libraries.value
      ?.filter((l) => !l.isDefault)
      .map((l) => ({
        label: l.name,
        icon: "i-lucide-folder",
        emoji: l.emoji,
        to: `/libraries/${l.id}`,
      })) ?? []
  );
});

const bottomItems = computed<NavItem[]>(() => {
  if (user.value?.role !== "owner") return [];
  return [
    {
      label: "Admin",
      icon: "i-lucide-shield-check",
      to: "/admin",
    },
  ];
});

const userMenuItems = computed<MenuAction[][]>(() => [
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
      onSelect: async (event?: Event) => {
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

function handleMenuAction(item: MenuAction) {
  userMenuOpen.value = false;
  if (item.onSelect) {
    item.onSelect();
  } else if (item.to) {
    router.push(item.to);
  }
}

function handleClickOutsideUserMenu(event: MouseEvent) {
  const menuEl = userMenuRef.value;
  if (!menuEl || !userMenuOpen.value) return;
  if (!menuEl.contains(event.target as Node)) {
    userMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", handleClickOutsideUserMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleClickOutsideUserMenu);
});

provide("refreshLibraries", refreshLibraries);
</script>

<template>
  <div class="drawer lg:drawer-open h-full overflow-hidden">
    <input id="dashboard-drawer" type="checkbox" class="drawer-toggle" />

    <!-- Main content -->
    <div class="drawer-content flex flex-col h-full overflow-hidden">
      <!-- Navbar -->
      <div class="navbar bg-base-100 border-b border-base-300 px-4">
        <div class="flex-none lg:hidden mr-2">
          <label for="dashboard-drawer" class="btn btn-ghost btn-circle" aria-label="open sidebar">
            <AppIcon name="i-lucide-menu" />
          </label>
        </div>
        <div class="flex-1 min-w-0">
          <form class="min-w-0 w-full max-w-sm" @submit.prevent="submitGlobalSearch">
            <label class="input w-full">
              <AppIcon name="i-lucide-search" class="opacity-50" />
              <input
                v-model="globalSearchQuery"
                type="search"
                autocomplete="off"
                enterkeyhint="search"
                placeholder="Search"
                class="grow"
              />
            </label>
          </form>
        </div>
        <div class="flex-none pl-4">
          <details ref="userMenuRef" class="dropdown dropdown-end" :open="userMenuOpen">
            <summary
              class="btn btn-soft btn-ghost btn-circle avatar"
              @click.prevent="userMenuOpen = !userMenuOpen"
            >
              <UserAvatar
                :display-name="user?.displayName ?? 'User'"
                :avatar-url="user?.avatarUrl ?? null"
                size-class="w-8"
                bg-class="bg-primary text-primary-content"
                text-size-class="text-sm"
              />
            </summary>
            <ul class="dropdown-content menu bg-base-100 rounded-box z-50 w-52 p-2 shadow mt-4">
              <template v-for="(group, gi) in userMenuItems" :key="gi">
                <div v-if="gi > 0" class="divider my-1" />
                <li v-for="item in group" :key="item.label">
                  <RouterLink v-if="item.to" :to="item.to" @click="handleMenuAction(item)">
                    <AppIcon :name="item.icon" />
                    {{ item.label }}
                  </RouterLink>
                  <button v-else @click="handleMenuAction(item)">
                    <AppIcon :name="item.icon" />
                    {{ item.label }}
                  </button>
                </li>
              </template>
            </ul>
          </details>
        </div>
      </div>

      <!-- Page content -->
      <div class="flex-1 min-h-0 p-4 sm:p-6 flex flex-col">
        <slot />
      </div>
    </div>

    <!-- Sidebar -->
    <div class="drawer-side">
      <label for="dashboard-drawer" aria-label="close sidebar" class="drawer-overlay" />
      <aside class="bg-base-100 h-full w-64 flex flex-col overflow-hidden">
        <!-- Sidebar header -->
        <div class="px-4 py-4 flex items-center gap-2">
          <img src="/logo.webp" alt="Alcoves" width="28" height="28" />
          <span class="text-lg font-bold truncate">Alcoves</span>
        </div>

        <!-- Default library nav -->
        <nav class="menu w-full px-2 pt-2">
          <li v-for="item in defaultLibraryItems" :key="item.to">
            <RouterLink :to="item.to" active-class="active" class="font-semibold">
              <span v-if="item.emoji" class="text-lg leading-none">{{ item.emoji }}</span>
              {{ item.label }}
            </RouterLink>
          </li>
        </nav>

        <div class="divider my-1 px-2" />

        <!-- Libraries section header -->
        <div class="flex items-center justify-between px-4 pt-1 pb-0.5">
          <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide"
            >Libraries</span
          >
          <button class="btn btn-soft btn-sm btn-ghost btn-square" @click="createLibrary">
            <AppIcon name="i-lucide-plus" />
          </button>
        </div>

        <!-- Library items -->
        <nav class="menu w-full px-2 flex-1 overflow-y-auto">
          <li v-for="item in libraryItems" :key="item.to">
            <RouterLink :to="item.to" active-class="active" class="font-semibold">
              <span v-if="item.emoji" class="text-lg leading-none">{{ item.emoji }}</span>
              {{ item.label }}
            </RouterLink>
          </li>
        </nav>

        <!-- Bottom nav (admin) -->
        <nav v-if="bottomItems.length" class="menu w-full px-2 mt-auto pb-4">
          <li v-for="item in bottomItems" :key="item.to">
            <RouterLink :to="item.to" active-class="active">
              <AppIcon :name="item.icon" />
              {{ item.label }}
            </RouterLink>
          </li>
        </nav>
      </aside>
    </div>
  </div>
</template>
