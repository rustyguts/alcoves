<script setup lang="ts">
import type { LibraryFile } from "~~/shared/types/api";

definePageMeta({
  layout: "dashboard",
});

const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const { data: library } = await useFetch(() => `/api/libraries/${libraryId.value}`);

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
  <div class="flex flex-col gap-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-10">
      <h1 class="text-xl font-semibold truncate">{{ library?.name }}</h1>
      <UButton
        label="Back to Library"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
        size="sm"
        :to="`/libraries/${libraryId}`"
      />
    </div>

    <div class="grid gap-4">
      <div v-if="selectedPeople.size >= 2" class="flex items-center gap-2">
        <UButton
          label="Merge Selected"
          icon="i-lucide-merge"
          color="primary"
          @click="mergePeople"
        />
        <span class="text-sm text-muted">{{ selectedPeople.size }} selected</span>
        <UButton
          label="Clear"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="selectedPeople.clear()"
        />
      </div>

      <div v-if="peopleLoading" class="flex items-center justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
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
              <UInput
                v-model="renamePersonValue"
                size="sm"
                autofocus
                placeholder="Enter a name"
                class="w-full"
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
          <UIcon name="i-lucide-scan-face" class="size-8 text-(--ui-text-muted)" />
        </div>
        <p class="text-lg font-medium text-foreground mb-1">No faces detected yet</p>
        <p class="text-sm text-muted">
          Upload images to this library and faces will be automatically detected and grouped.
        </p>
      </div>
    </div>

    <UModal
      :open="!!activePerson"
      title="Person's Photos"
      @update:open="
        (v: boolean) => {
          if (!v) closePersonDetail();
        }
      "
    >
      <template #body>
        <div v-if="activePerson">
          <div v-if="loadingFaces" class="flex justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
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
                <UIcon
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
                format="jpeg"
                :quality="80"
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
                  <UButton
                    label="Wrong match"
                    size="xs"
                    color="neutral"
                    variant="outline"
                    :loading="splittingFaceId === face.id"
                    @click.stop="openSplitFaceModal(face.id, face.fileName)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId || ''"
      :files="files"
      @navigate="previewFile = $event"
    />

    <UModal v-model:open="splitFaceOpen" title="Create New Person">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            This face will be removed from the current person and placed into a new one.
          </p>
          <p class="text-xs text-muted truncate">
            Selected photo: {{ splitFaceTarget?.fileName ?? "Unknown file" }}
          </p>
          <UFormField label="Name (optional)">
            <UInput
              v-model="splitFaceName"
              placeholder="e.g. Alex"
              class="w-full"
              @keydown.enter.prevent="confirmSplitFace"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            :disabled="!!splittingFaceId"
            @click="splitFaceOpen = false"
          />
          <UButton
            label="Create New Person"
            icon="i-lucide-user-round-plus"
            :loading="!!splittingFaceId"
            @click="confirmSplitFace"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
