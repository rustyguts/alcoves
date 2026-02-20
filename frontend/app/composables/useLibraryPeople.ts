import type { Ref, ComputedRef } from "vue";
import type { LibraryPerson, PersonFace } from "~~/shared/types/api";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";

export function useLibraryPeople(libraryId: Ref<string> | ComputedRef<string>) {
  const toast = useToast();

  const people = ref<LibraryPerson[]>([]);
  const loading = ref(false);
  const selectedPeople = reactive(new Set<string>());
  const activePerson = ref<LibraryPerson | null>(null);
  const activePersonFaces = ref<PersonFace[]>([]);
  const loadingFaces = ref(false);
  const updatingCoverFaceId = ref<string | null>(null);
  const splittingFaceId = ref<string | null>(null);

  async function fetchPeople() {
    loading.value = true;
    try {
      people.value = await api.people.list(libraryId.value);
    } catch {
      toast.add({ title: "Failed to load people", color: "error" });
    } finally {
      loading.value = false;
    }
  }

  async function renamePerson(personId: string, name: string) {
    try {
      const updated = await api.people.update(libraryId.value, personId, { name });
      const idx = people.value.findIndex((p) => p.id === personId);
      if (idx !== -1) people.value[idx] = updated;
      if (activePerson.value?.id === personId) activePerson.value = updated;
      toast.add({ title: "Person renamed" });
    } catch {
      toast.add({ title: "Failed to rename person", color: "error" });
    }
  }

  async function mergePeople() {
    const ids = Array.from(selectedPeople);
    if (ids.length < 2) return;

    try {
      await api.people.merge(libraryId.value, { personIds: ids });
      selectedPeople.clear();
      await fetchPeople();
      toast.add({ title: "People merged" });
    } catch {
      toast.add({ title: "Failed to merge people", color: "error" });
    }
  }

  async function loadPersonFaces(person: LibraryPerson) {
    activePerson.value = person;
    loadingFaces.value = true;
    try {
      activePersonFaces.value = await api.people.listFaces(libraryId.value, person.id);
    } catch {
      toast.add({ title: "Failed to load faces", color: "error" });
    } finally {
      loadingFaces.value = false;
    }
  }

  function togglePersonSelection(personId: string) {
    if (selectedPeople.has(personId)) {
      selectedPeople.delete(personId);
    } else {
      selectedPeople.add(personId);
    }
  }

  function getPersonThumbnailUrl(person: LibraryPerson): string {
    const version = person.coverFaceDetectionId ?? person.updatedAt;
    return api.people.thumbnailUrl(libraryId.value, person.id, version);
  }

  async function setPersonCover(personId: string, faceDetectionId: string) {
    updatingCoverFaceId.value = faceDetectionId;
    try {
      const updated = await api.people.update(libraryId.value, personId, {
        coverFaceDetectionId: faceDetectionId,
      });

      const idx = people.value.findIndex((p) => p.id === personId);
      if (idx !== -1) people.value[idx] = updated;
      if (activePerson.value?.id === personId) activePerson.value = updated;

      toast.add({ title: "Cover photo updated" });
    } catch {
      toast.add({ title: "Failed to update cover photo", color: "error" });
    } finally {
      updatingCoverFaceId.value = null;
    }
  }

  async function splitFaceAsNewPerson(personId: string, faceDetectionId: string, name?: string) {
    splittingFaceId.value = faceDetectionId;
    try {
      await api.people.splitFace(libraryId.value, personId, faceDetectionId, { name });
      await fetchPeople();
      if (activePerson.value?.id === personId) {
        const refreshed = people.value.find((person) => person.id === personId) ?? null;
        if (refreshed) {
          activePerson.value = refreshed;
          await loadPersonFaces(refreshed);
        } else {
          closePersonDetail();
        }
      }
      toast.add({ title: "Face moved to a new person" });
    } catch {
      toast.add({ title: "Failed to create a new person from this face", color: "error" });
    } finally {
      splittingFaceId.value = null;
    }
  }

  function closePersonDetail() {
    activePerson.value = null;
    activePersonFaces.value = [];
  }

  return {
    people,
    loading,
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
  };
}
