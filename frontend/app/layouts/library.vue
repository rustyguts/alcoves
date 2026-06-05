<script setup lang="ts">
import { useApiFetch } from "~/composables/useApiFetch";
import { useAuth } from "~/composables/useAuth";
import LibraryHeader from "~/components/LibraryHeader.vue";
import type { Library } from "~~/shared/types/api";

const route = useRoute();
const { user } = useAuth();
const libraryId = computed(() => route.params.id as string);

// The timeline runs a full-bleed Google-Photos gallery; drop the breadcrumb row
// (and tighten the shell spacing) so it reclaims the vertical space.
const isTimeline = computed(() => route.path.endsWith("/timeline"));

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
    <div class="flex flex-col flex-1 min-h-0" :class="isTimeline ? 'gap-2' : 'gap-4'">
      <LibraryHeader
        :library-id="libraryId"
        :name="library?.name"
        :emoji="library?.emoji"
        :hide-heading="isTimeline"
      >
        <template #actions>
          <!-- Teleport target: library pages (e.g. Files) inject their toolbar
               here so it shares the breadcrumb row instead of taking its own. -->
          <div id="library-header-actions" class="flex items-center gap-1.5" />
        </template>
      </LibraryHeader>

      <div class="relative flex flex-col flex-1 min-h-0">
        <slot />
      </div>
    </div>
  </NuxtLayout>
</template>
