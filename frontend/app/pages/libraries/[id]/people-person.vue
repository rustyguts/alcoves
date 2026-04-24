<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import AppIcon from "~/components/AppIcon.vue";
import AppContextMenu from "~/components/AppContextMenu.vue";
import AlcovesImage from "~/components/AlcovesImage.vue";
import FilePreview from "~/components/FilePreview.vue";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import type { LibraryFile, LibraryPerson, PersonFace } from "~~/shared/types/api";

type FaceContextAction = "update-cover" | "new-person";

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
const contextMenuPosition = ref<{ x: number; y: number } | null>(null);

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

function showFaceContextMenu(face: PersonFace, event: MouseEvent) {
  event.preventDefault();
  contextMenuFace.value = face;
  contextMenuPosition.value = { x: event.clientX, y: event.clientY };
}

function hideFaceContextMenu() {
  contextMenuFace.value = null;
  contextMenuPosition.value = null;
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

async function handleFaceAction(action: FaceContextAction) {
  const face = contextMenuFace.value;
  hideFaceContextMenu();
  if (!face) return;

  if (action === "update-cover") {
    await updateCoverPhoto(face.id);
    return;
  }

  await createNewPerson(face.id);
}

watch(
  [libraryId, personId],
  () => {
    fetchPersonAndFaces();
  },
  { immediate: true },
);

onMounted(() => {
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") hideFaceContextMenu();
  };
  window.addEventListener("keydown", handleEscape);
  onUnmounted(() => window.removeEventListener("keydown", handleEscape));
});
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

    <div
      v-else-if="faces.length"
      class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2"
    >
      <div
        v-for="face in faces"
        :key="face.id"
        class="relative overflow-hidden rounded-xl border border-default bg-elevated cursor-pointer transition hover:border-accented"
        @click="openFacePreview(face)"
        @contextmenu="showFaceContextMenu(face, $event)"
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

    <div v-else class="flex items-center justify-center py-16">
      <p class="text-sm text-muted">No faces available for this person</p>
    </div>

    <AppContextMenu
      :open="!!contextMenuFace && !!contextMenuPosition"
      :position="contextMenuPosition"
      @close="hideFaceContextMenu"
    >
      <div class="rounded-xl bg-default border border-default shadow-xl min-w-56 p-1 flex flex-col">
        <button
          type="button"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-default hover:bg-elevated transition"
          @click="handleFaceAction('update-cover')"
        >
          <UIcon name="i-lucide-image-up" class="size-4 shrink-0" />
          <span>Update cover photo</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-default hover:bg-elevated transition"
          @click="handleFaceAction('new-person')"
        >
          <UIcon name="i-lucide-user-round-plus" class="size-4 shrink-0" />
          <span>New person</span>
        </button>
      </div>
    </AppContextMenu>

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
