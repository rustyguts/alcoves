<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import { useLibraryPeople } from "~/composables/useLibraryPeople";
import AppIcon from "~/components/AppIcon.vue";
import type { Library } from "~~/shared/types/api";

const route = useRoute();
const router = useRouter();
const libraryId = computed(() => route.params.id as string);
const { data: library } = useApiFetch<Library>(() => `/api/libraries/${libraryId.value}`);
const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const {
  people: libraryPeople,
  loading: peopleLoading,
  selectedPeople,
  fetchPeople,
  renamePerson,
  mergePeople,
  togglePersonSelection,
  getPersonThumbnailUrl,
} = useLibraryPeople(libraryId);

const renamePersonOpen = ref(false);
const renamePersonTarget = ref<{ id: string; name: string | null } | null>(null);
const renamePersonValue = ref("");
const renamingPersonSavingId = ref<string | null>(null);

function openRenamePersonModal(person: { id: string; name: string | null }) {
  renamePersonTarget.value = person;
  renamePersonValue.value = person.name ?? "";
  renamePersonOpen.value = true;
}

function closeRenamePersonModal() {
  if (renamingPersonSavingId.value) return;
  renamePersonOpen.value = false;
  renamePersonTarget.value = null;
  renamePersonValue.value = "";
}

async function confirmRenamePerson() {
  const target = renamePersonTarget.value;
  if (!target || renamingPersonSavingId.value) return;

  renamingPersonSavingId.value = target.id;
  await renamePerson(target.id, renamePersonValue.value.trim());
  renamingPersonSavingId.value = null;
  closeRenamePersonModal();
}

function openPerson(personId: string) {
  void router.push(`/libraries/${libraryId.value}/people/${personId}`);
}

function getPersonAlt(person: { name: string | null }): string {
  return person.name?.trim() || "Unnamed person";
}

onMounted(() => {
  fetchPeople();
});
</script>

<template>
  <div class="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0">
    <div class="grid gap-4">
      <div v-if="selectedPeople.size >= 2" class="flex items-center gap-2">
        <UButton color="primary" size="sm" icon="i-lucide-merge" @click="mergePeople">
          Merge Selected
        </UButton>
        <span class="text-sm text-muted">{{ selectedPeople.size }} selected</span>
        <UButton color="neutral" variant="ghost" size="sm" @click="selectedPeople.clear()">
          Clear
        </UButton>
      </div>

      <div v-if="peopleLoading" class="flex items-center justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div v-else-if="libraryPeople.length" class="space-y-2 p-2">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="person in libraryPeople"
            :key="person.id"
            type="button"
            class="group relative size-40 shrink-0 overflow-hidden rounded-xl border border-default bg-elevated cursor-pointer select-none transition"
            :class="
              selectedPeople.has(person.id)
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-default'
                : 'hover:border-accented'
            "
            :title="person.name?.trim() || 'Unnamed person'"
            @click="togglePersonSelection(person.id)"
            @dblclick="openPerson(person.id)"
            @contextmenu.prevent="openRenamePersonModal(person)"
          >
            <img
              :src="getPersonThumbnailUrl(person)"
              :alt="getPersonAlt(person)"
              class="size-full object-cover"
              loading="lazy"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
            <div
              class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
            />
            <div
              class="pointer-events-none absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white"
            >
              {{ person.faceCount }}
            </div>
            <div v-if="person.name?.trim()" class="pointer-events-none absolute inset-x-2 bottom-2">
              <p class="truncate text-center text-xs font-medium text-white">
                {{ person.name }}
              </p>
            </div>
          </button>
        </div>
      </div>

      <div v-else class="flex flex-col items-center justify-center py-16 px-4">
        <div class="size-16 rounded-full bg-elevated flex items-center justify-center mb-4">
          <UIcon name="i-lucide-scan-face" class="size-8 text-muted" />
        </div>
        <p class="text-lg font-medium text-default mb-1">No faces detected yet</p>
        <p class="text-sm text-muted text-center max-w-md">
          Upload images to this library and faces will be automatically detected and grouped.
        </p>
      </div>
    </div>

    <!-- Rename person modal -->
    <UModal
      v-model:open="renamePersonOpen"
      title="Name Person"
      description="Leave blank to remove the name"
      :dismissible="!renamingPersonSavingId"
    >
      <template #body>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Person name</label>
          <UInput
            v-model="renamePersonValue"
            autofocus
            placeholder="e.g. Alex"
            :ui="{ root: 'w-full' }"
            @keydown.enter.prevent="confirmRenamePerson"
          />
          <p class="text-xs text-muted">Leave blank to remove the name</p>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="!!renamingPersonSavingId"
            @click="closeRenamePersonModal"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            size="sm"
            :loading="!!renamingPersonSavingId"
            :disabled="!!renamingPersonSavingId || !renamePersonTarget"
            @click="confirmRenamePerson"
          >
            Save
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
