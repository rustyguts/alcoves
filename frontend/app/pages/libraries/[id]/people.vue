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
        <button class="btn btn-sm btn-primary" @click="mergePeople">
          <AppIcon name="i-lucide-merge" class="size-4" />
          Merge Selected
        </button>
        <span class="text-sm text-muted">{{ selectedPeople.size }} selected</span>
        <button class="btn btn-soft btn-sm btn-ghost" @click="selectedPeople.clear()">Clear</button>
      </div>

      <div v-if="peopleLoading" class="flex items-center justify-center py-16">
        <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div v-else-if="libraryPeople.length" class="space-y-2 p-2">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="person in libraryPeople"
            :key="person.id"
            type="button"
            class="group relative size-40 shrink-0 overflow-hidden rounded-box border border-base-300 bg-base-200 cursor-pointer select-none transition"
            :class="
              selectedPeople.has(person.id)
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100'
                : 'hover:border-base-content/40'
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
        <div
          class="size-16 rounded-full bg-(--ui-bg-elevated) flex items-center justify-center mb-4"
        >
          <AppIcon name="i-lucide-scan-face" class="size-8 text-(--ui-text-muted)" />
        </div>
        <p class="text-lg font-medium text-foreground mb-1">No faces detected yet</p>
        <p class="text-sm text-muted">
          Upload images to this library and faces will be automatically detected and grouped.
        </p>
      </div>
    </div>

    <!-- Rename person modal -->
    <dialog class="modal" :class="{ 'modal-open': renamePersonOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold mb-4">Name Person</h3>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Person name</legend>
          <input
            v-model="renamePersonValue"
            autofocus
            placeholder="e.g. Alex"
            class="input w-full"
            @keydown.enter.prevent="confirmRenamePerson"
          />
        </fieldset>
        <p class="mt-2 text-xs text-muted">Leave blank to remove the name</p>
        <div class="modal-action">
          <button
            class="btn btn-soft btn-sm btn-outline"
            :disabled="!!renamingPersonSavingId"
            @click="closeRenamePersonModal"
          >
            Cancel
          </button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="!!renamingPersonSavingId || !renamePersonTarget"
            @click="confirmRenamePerson"
          >
            <span v-if="!!renamingPersonSavingId" class="loading loading-spinner loading-xs"></span>
            Save
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closeRenamePersonModal">close</button>
      </form>
    </dialog>
  </div>
</template>
