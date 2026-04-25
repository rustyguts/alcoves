<script setup lang="ts">
import AlcovesImage from "~/components/AlcovesImage.vue";

definePageMeta({ layout: "library" });

import FilePreview from "~/components/FilePreview.vue";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import type { ContextMenuItem } from "@nuxt/ui";
import type { LibraryFile, LibraryPerson, PersonFace } from "~~/shared/types/api";

const route = useRoute();
const router = useRouter();
const toast = useToast();
const libraryId = computed(() => route.params.id as string);
const personId = computed(() => route.params.personId as string);
const person = ref<LibraryPerson | null>(null);
const faces = ref<PersonFace[]>([]);
const loading = ref(false);
const actionFaceId = ref<string | null>(null);
const previewFile = ref<LibraryFile | null>(null);
const previewOpen = ref(false);
const fileCache = ref<Record<string, LibraryFile>>({});

const contextMenuFace = ref<PersonFace | null>(null);

const personLabel = computed(() => person.value?.name?.trim() || "Unnamed person");
const previewFiles = computed<LibraryFile[]>(() => {
  if (!previewFile.value) return [];
  return [previewFile.value];
});

function goBack() {
  void router.push(`/libraries/${libraryId.value}/people`);
}

async function fetchPersonAndFaces() {
  loading.value = true;
  try {
    const people = await apiFetch<LibraryPerson[]>(`/api/libraries/${libraryId.value}/people`);
    const found = people.find((candidate) => candidate.id === personId.value) ?? null;
    person.value = found;

    if (!found) {
      faces.value = [];
      return;
    }

    faces.value = await apiFetch<PersonFace[]>(
      `/api/libraries/${libraryId.value}/people/${personId.value}/faces`,
    );
  } catch {
    toast.add({ title: "Failed to load person", color: "error" });
  } finally {
    loading.value = false;
  }
}

async function openFacePreview(face: PersonFace) {
  const cached = fileCache.value[face.fileId];
  if (cached) {
    previewFile.value = cached;
    previewOpen.value = true;
    return;
  }

  try {
    const file = await apiFetch<LibraryFile>(
      `/api/libraries/${libraryId.value}/files/${face.fileId}`,
    );
    fileCache.value[file.id] = file;
    previewFile.value = file;
    previewOpen.value = true;
  } catch {
    toast.add({ title: "Failed to load file preview", color: "error" });
  }
}

function showFaceContextMenu(face: PersonFace) {
  contextMenuFace.value = face;
}

async function updateCoverPhoto(faceId: string) {
  actionFaceId.value = faceId;
  try {
    const updated = await apiFetch<LibraryPerson>(
      `/api/libraries/${libraryId.value}/people/${personId.value}`,
      {
        method: "PATCH",
        body: { coverFaceDetectionId: faceId },
      },
    );
    person.value = updated;
    toast.add({ title: "Cover photo updated" });
  } catch {
    toast.add({ title: "Failed to update cover photo", color: "error" });
  } finally {
    actionFaceId.value = null;
  }
}

async function createNewPerson(faceId: string) {
  actionFaceId.value = faceId;
  try {
    await apiFetch(
      `/api/libraries/${libraryId.value}/people/${personId.value}/faces/${faceId}/split`,
      {
        method: "POST",
      },
    );
    toast.add({ title: "Face moved to a new person" });
    await fetchPersonAndFaces();
    if (!person.value || faces.value.length === 0) {
      goBack();
    }
  } catch {
    toast.add({ title: "Failed to create a new person from this face", color: "error" });
  } finally {
    actionFaceId.value = null;
  }
}

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const face = contextMenuFace.value;
  if (!face) return [];
  return [
    {
      label: "Update cover photo",
      icon: "i-lucide-image-up",
      onSelect: () => updateCoverPhoto(face.id),
    },
    {
      label: "New person",
      icon: "i-lucide-user-round-plus",
      onSelect: () => createNewPerson(face.id),
    },
  ];
});

watch(
  [libraryId, personId],
  () => {
    fetchPersonAndFaces();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 p-2">
    <div class="flex items-center gap-3">
      <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-left" @click="goBack">
        Back
      </UButton>
      <div class="min-w-0">
        <p class="text-sm font-semibold truncate">{{ personLabel }}</p>
        <p class="text-xs text-muted">
          {{ faces.length }} {{ faces.length === 1 ? "face" : "faces" }}
        </p>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
    </div>

    <div v-else-if="!person" class="flex flex-col items-center justify-center py-16 px-4 gap-3">
      <p class="text-sm text-muted">Person not found in this library</p>
      <UButton color="primary" size="sm" @click="goBack">Back to People</UButton>
    </div>

    <UContextMenu
      v-else-if="faces.length"
      :items="contextMenuItems"
      :ui="{ content: 'w-56' }"
    >
      <div
        class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2"
      >
        <div
          v-for="face in faces"
          :key="face.id"
          class="relative overflow-hidden rounded-xl border border-default bg-elevated cursor-pointer transition hover:border-accented"
          @click="openFacePreview(face)"
          @contextmenu="showFaceContextMenu(face)"
        >
          <AlcovesImage
            :library-id="libraryId"
            :file-id="face.fileId"
            :alt="face.fileName"
            :width="300"
            :height="300"
            class="w-full aspect-square object-cover"
          />
          <div
            v-if="actionFaceId === face.id"
            class="absolute inset-0 bg-black/40 flex items-center justify-center"
          >
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white" />
          </div>
        </div>
      </div>
    </UContextMenu>

    <div v-else class="flex items-center justify-center py-16">
      <p class="text-sm text-muted">No faces available for this person</p>
    </div>

    <FilePreview
      v-if="previewFile"
      v-model:open="previewOpen"
      :file="previewFile"
      :library-id="libraryId"
      :files="previewFiles"
      @navigate="previewFile = $event"
    />
  </div>
</template>
