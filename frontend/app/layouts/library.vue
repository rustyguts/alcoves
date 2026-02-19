<script setup lang="ts">
import { useRoute } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import { useAuth } from "~/composables/useAuth";
import { apiFetch } from "~/utils/api-fetch";
import LibraryHeader from "~/components/LibraryHeader.vue";
import LibraryTabs from "~/components/LibraryTabs.vue";
import type { Library } from "~~/shared/types/api";

const route = useRoute();
const { user } = useAuth();
const libraryId = computed(() => route.params.id as string);

const { data: library, refresh: refreshLibrary } = useApiFetch<Library>(
  () => `/api/libraries/${libraryId.value}`,
);

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const canManageLibrary = computed(() => {
  if (library.value?.ownerId && user.value?.id && library.value.ownerId === user.value.id) {
    return true;
  }
  const role = library.value?.currentUserRole;
  return role === "owner" || role === "admin";
});

const isFileOrTrashRoute = computed(() => {
  const path = route.path;
  return path === `/libraries/${libraryId.value}` || path === `/libraries/${libraryId.value}/trash`;
});

async function saveLibraryName(name: string) {
  await apiFetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { name },
  });
  await refreshLibrary();
}

async function saveLibraryEmoji(emoji: string | null) {
  await apiFetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { emoji: emoji ?? "" },
  });
  await refreshLibrary();
}

provide("libraryId", libraryId);
provide("library", library);
provide("refreshLibrary", refreshLibrary);
provide("canManageLibrary", canManageLibrary);
</script>

<template>
  <div class="flex flex-col gap-4 flex-1 min-h-0">
    <template v-if="!isFileOrTrashRoute">
      <LibraryHeader
        :name="library?.name"
        :emoji="library?.emoji"
        :can-edit="canManageLibrary"
        @update:name="saveLibraryName"
        @update:emoji="saveLibraryEmoji"
      />

      <LibraryTabs
        :library-id="libraryId"
        :face-recognition-enabled="library?.faceRecognitionEnabled"
        :can-manage-library="canManageLibrary"
      />
    </template>

    <div class="relative flex-1 min-h-0">
      <RouterView v-slot="{ Component, route: tabRoute }">
        <Transition
          mode="out-in"
          enter-active-class="transition-opacity duration-120 ease-out"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition-opacity duration-90 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <component :is="Component" :key="tabRoute.path" />
        </Transition>
      </RouterView>
    </div>
  </div>
</template>
