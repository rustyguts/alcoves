<script setup lang="ts">
import { useRoute } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import { useLibraryPeople } from "~/composables/useLibraryPeople";
import AppIcon from "~/components/AppIcon.vue";
import AlcovesImage from "~/components/AlcovesImage.vue";
import FilePreview from "~/components/FilePreview.vue";
import type { Library, LibraryFile } from "~~/shared/types/api";

const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const { data: library } = useApiFetch<Library>(() => `/api/libraries/${libraryId.value}`);
const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

watch(library, () => {
  refreshLibraries?.();
});

const files = ref<LibraryFile[]>([]);

const {
  people: libraryPeople,
  loading: peopleLoading,
  selectedPeople,
  activePerson,
  activePersonFaces,
  loadingFaces,
  updatingCoverFaceId,
  splittingFaceId,
  fetchPeople,
  renamePerson,
  mergePeople,
  loadPersonFaces,
  setPersonCover,
  splitFaceAsNewPerson,
  togglePersonSelection,
  getPersonThumbnailUrl,
  closePersonDetail,
} = useLibraryPeople(libraryId);

const renamingPersonId = ref<string | null>(null);
const renamePersonValue = ref("");
const renamingPersonSavingId = ref<string | null>(null);
const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);
const splitFaceOpen = ref(false);
const splitFaceName = ref("");
const splitFaceTarget = ref<{ faceId: string; fileName: string } | null>(null);

function startPersonRename(person: { id: string; name: string | null }) {
  renamingPersonId.value = person.id;
  renamePersonValue.value = person.name ?? "";
}

async function savePersonRename(personId: string) {
  if (renamingPersonId.value !== personId || renamingPersonSavingId.value === personId) return;
  renamingPersonSavingId.value = personId;
  renamingPersonId.value = null;
  await renamePerson(personId, renamePersonValue.value);
  renamingPersonSavingId.value = null;
}

function getPersonLabel(person: { name: string | null }): string {
  return person.name?.trim() || "Name this person";
}

function getPersonAlt(person: { name: string | null }): string {
  return person.name?.trim() || "Unnamed person";
}

function openSplitFaceModal(faceId: string, fileName: string) {
  splitFaceTarget.value = { faceId, fileName };
  splitFaceName.value = "";
  splitFaceOpen.value = true;
}

async function confirmSplitFace() {
  const active = activePerson.value;
  const target = splitFaceTarget.value;
  if (!active || !target) return;

  await splitFaceAsNewPerson(active.id, target.faceId, splitFaceName.value);
  splitFaceOpen.value = false;
  splitFaceTarget.value = null;
}

onMounted(() => {
  fetchPeople();
});
</script>

<template>
  <div class="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0">
    <div class="grid gap-4">
      <div v-if="selectedPeople.size >= 2" class="flex items-center gap-2">
        <button
          class="btn btn-sm btn-primary"
          @click="mergePeople"
        >
          <AppIcon name="i-lucide-merge" class="size-4" />
          Merge Selected
        </button>
        <span class="text-sm text-muted">{{ selectedPeople.size }} selected</span>
        <button
          class="btn btn-sm btn-neutral btn-ghost"
          @click="selectedPeople.clear()"
        >
          Clear
        </button>
      </div>

      <div v-if="peopleLoading" class="flex items-center justify-center py-16">
        <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div
        v-else-if="libraryPeople.length"
        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
      >
        <div
          v-for="person in libraryPeople"
          :key="person.id"
          class="flex flex-col items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors select-none"
          :class="
            selectedPeople.has(person.id)
              ? 'ring-2 ring-primary/50 bg-primary/5'
              : 'hover:bg-elevated/50'
          "
          @click="togglePersonSelection(person.id)"
          @dblclick="loadPersonFaces(person)"
        >
          <img
            :src="getPersonThumbnailUrl(person)"
            :alt="getPersonAlt(person)"
            class="size-20 rounded-full object-cover border-2 border-default"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <div class="text-center w-full">
            <template v-if="renamingPersonId === person.id">
              <input
                v-model="renamePersonValue"
                autofocus
                placeholder="Enter a name"
                class="input input-sm w-full"
                @blur="savePersonRename(person.id)"
                @keydown.enter.prevent="savePersonRename(person.id)"
                @keydown.escape="renamingPersonId = null"
                @click.stop
              />
            </template>
            <template v-else>
              <button
                type="button"
                class="text-sm font-medium truncate w-full hover:text-primary transition-colors"
                @click.stop="startPersonRename(person)"
              >
                {{ getPersonLabel(person) }}
              </button>
            </template>
            <p v-if="!person.name" class="text-[11px] text-muted">Tap to add a name</p>
            <p class="text-xs text-muted">
              {{ person.faceCount }} {{ person.faceCount === 1 ? "photo" : "photos" }}
            </p>
          </div>
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

    <!-- Person detail modal -->
    <dialog class="modal" :class="{ 'modal-open': !!activePerson }">
      <div class="modal-box">
        <h3 class="text-lg font-bold mb-4">Person's Photos</h3>
        <div v-if="activePerson">
          <div v-if="loadingFaces" class="flex justify-center py-8">
            <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
          </div>
          <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div
              v-for="face in activePersonFaces"
              :key="face.id"
              class="relative rounded-lg overflow-hidden bg-elevated/50"
            >
              <button
                type="button"
                class="absolute top-2 right-2 z-10 rounded-full p-1.5 transition-colors"
                :class="
                  activePerson.coverFaceDetectionId === face.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-black/50 text-white hover:bg-black/70'
                "
                :title="
                  activePerson.coverFaceDetectionId === face.id
                    ? 'Current cover photo'
                    : 'Set as cover photo'
                "
                :disabled="updatingCoverFaceId === face.id"
                @click.stop="setPersonCover(activePerson.id, face.id)"
              >
                <AppIcon
                  :name="
                    activePerson.coverFaceDetectionId === face.id
                      ? 'i-lucide-check'
                      : 'i-lucide-image-up'
                  "
                  class="size-4"
                />
              </button>
              <AlcovesImage
                :library-id="libraryId || ''"
                :file-id="face.fileId"
                :alt="face.fileName"
                :width="300"
                :height="300"
                class="w-full aspect-square object-cover"
              />
              <div class="p-2">
                <p class="text-xs truncate">{{ face.fileName }}</p>
                <div class="mt-1 flex items-center justify-between gap-2">
                  <p
                    v-if="activePerson.coverFaceDetectionId === face.id"
                    class="text-[11px] text-primary"
                  >
                    Cover photo
                  </p>
                  <button
                    class="btn btn-xs btn-neutral btn-outline"
                    :disabled="splittingFaceId === face.id"
                    @click.stop="openSplitFaceModal(face.id, face.fileName)"
                  >
                    <span v-if="splittingFaceId === face.id" class="loading loading-spinner loading-xs"></span>
                    Wrong match
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="closePersonDetail()">close</button>
      </form>
    </dialog>

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId || ''"
      :files="files"
      @navigate="previewFile = $event"
    />

    <!-- Split face modal -->
    <dialog class="modal" :class="{ 'modal-open': splitFaceOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold mb-4">Create New Person</h3>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            This face will be removed from the current person and placed into a new one.
          </p>
          <p class="text-xs text-muted truncate">
            Selected photo: {{ splitFaceTarget?.fileName ?? "Unknown file" }}
          </p>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Name (optional)</legend>
            <input
              v-model="splitFaceName"
              placeholder="e.g. Alex"
              class="input w-full"
              @keydown.enter.prevent="confirmSplitFace"
            />
          </fieldset>
        </div>
        <div class="modal-action">
          <button
            class="btn btn-sm btn-neutral btn-outline"
            :disabled="!!splittingFaceId"
            @click="splitFaceOpen = false"
          >
            Cancel
          </button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="!!splittingFaceId"
            @click="confirmSplitFace"
          >
            <span v-if="!!splittingFaceId" class="loading loading-spinner loading-xs"></span>
            <AppIcon v-else name="i-lucide-user-round-plus" class="size-4" />
            Create New Person
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="splitFaceOpen = false">close</button>
      </form>
    </dialog>
  </div>
</template>
