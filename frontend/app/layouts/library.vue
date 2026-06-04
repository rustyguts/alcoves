<script setup lang="ts">
import { useApiFetch } from "~/composables/useApiFetch";
import { useAuth } from "~/composables/useAuth";
import LibraryHeader from "~/components/LibraryHeader.vue";
import LibraryTabs from "~/components/LibraryTabs.vue";
import type { Library } from "~~/shared/types/api";

const route = useRoute();
const { user } = useAuth();
const libraryId = computed(() => route.params.id as string);

const { data: library, refresh: refreshLibrary } = useApiFetch<Library>(
  () => `/api/libraries/${libraryId.value}`,
);

const { refreshLibraries: refreshLibrariesList } = useLibrariesList();

watch(library, () => {
  refreshLibrariesList();
});

const canManageLibrary = computed(() => {
  if (library.value?.ownerId && user.value?.id && library.value.ownerId === user.value.id) {
    return true;
  }
  const role = library.value?.currentUserRole;
  return role === "owner" || role === "admin";
});

provide("libraryId", libraryId);
provide("library", library);
provide("refreshLibrary", refreshLibrary);
provide("canManageLibrary", canManageLibrary);
</script>

<template>
  <NuxtLayout name="dashboard">
    <div class="flex flex-col gap-4 flex-1 min-h-0">
      <LibraryHeader :library-id="libraryId" :name="library?.name" :emoji="library?.emoji">
        <LibraryTabs
          :library-id="libraryId"
          :face-recognition-enabled="library?.faceRecognitionEnabled"
          :object-detection-enabled="library?.objectDetectionEnabled"
          :can-manage-library="canManageLibrary"
        />
      </LibraryHeader>

      <div class="relative flex flex-col flex-1 min-h-0">
        <slot />
      </div>
    </div>
  </NuxtLayout>
</template>
