import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import type { LibraryPerson, PersonFace } from '$lib/types/api';

/**
 * People / faces management for a single library.
 *
 * Ported from the Nuxt `useLibraryPeople` composable. `getLibraryId` is a getter
 * so the store tracks a reactive library id from the consuming component (the Vue
 * version took a `Ref<string>`). All reactive fields are exposed via getters so
 * reactivity survives the function boundary; the component calls `fetchPeople()`
 * from its own `onMount`/`$effect`.
 *
 * `selectedPeople` mirrors the old `reactive(new Set)` — it is reassigned (not
 * mutated in place) so the `$state` Set stays reactive across reads.
 */
export function createLibraryPeople(getLibraryId: () => string) {
	let people = $state<LibraryPerson[]>([]);
	let loading = $state(false);
	// Selection uses the immutable-reassignment pattern (a new Set is assigned to
	// the $state on every change), so a plain Set is reactive here.

	let selectedPeople = $state(new Set<string>());
	let activePerson = $state<LibraryPerson | null>(null);
	let activePersonFaces = $state<PersonFace[]>([]);
	let loadingFaces = $state(false);
	let updatingCoverFaceId = $state<string | null>(null);
	let splittingFaceId = $state<string | null>(null);

	async function fetchPeople() {
		loading = true;
		try {
			people = await api.people.list(getLibraryId());
		} catch {
			toast.add({ title: 'Failed to load people', color: 'error' });
		} finally {
			loading = false;
		}
	}

	async function renamePerson(personId: string, name: string) {
		try {
			const updated = await api.people.update(getLibraryId(), personId, { name });
			const idx = people.findIndex((p) => p.id === personId);
			if (idx !== -1) people[idx] = updated;
			if (activePerson?.id === personId) activePerson = updated;
			toast.add({ title: 'Person renamed' });
		} catch {
			toast.add({ title: 'Failed to rename person', color: 'error' });
		}
	}

	async function mergePeople() {
		const ids = Array.from(selectedPeople);
		if (ids.length < 2) return;

		try {
			await api.people.merge(getLibraryId(), { personIds: ids });

			selectedPeople = new Set();
			await fetchPeople();
			toast.add({ title: 'People merged' });
		} catch {
			toast.add({ title: 'Failed to merge people', color: 'error' });
		}
	}

	async function loadPersonFaces(person: LibraryPerson) {
		activePerson = person;
		loadingFaces = true;
		try {
			activePersonFaces = await api.people.listFaces(getLibraryId(), person.id);
		} catch {
			toast.add({ title: 'Failed to load faces', color: 'error' });
		} finally {
			loadingFaces = false;
		}
	}

	function togglePersonSelection(personId: string) {
		const next = new Set(selectedPeople);
		if (next.has(personId)) {
			next.delete(personId);
		} else {
			next.add(personId);
		}
		selectedPeople = next;
	}

	function getPersonThumbnailUrl(person: LibraryPerson): string {
		const version = person.coverFaceDetectionId ?? person.updatedAt;
		return api.people.thumbnailUrl(getLibraryId(), person.id, version);
	}

	async function setPersonCover(personId: string, faceDetectionId: string) {
		updatingCoverFaceId = faceDetectionId;
		try {
			const updated = await api.people.update(getLibraryId(), personId, {
				coverFaceDetectionId: faceDetectionId
			});

			const idx = people.findIndex((p) => p.id === personId);
			if (idx !== -1) people[idx] = updated;
			if (activePerson?.id === personId) activePerson = updated;

			toast.add({ title: 'Cover photo updated' });
		} catch {
			toast.add({ title: 'Failed to update cover photo', color: 'error' });
		} finally {
			updatingCoverFaceId = null;
		}
	}

	async function splitFaceAsNewPerson(personId: string, faceDetectionId: string, name?: string) {
		splittingFaceId = faceDetectionId;
		try {
			await api.people.splitFace(getLibraryId(), personId, faceDetectionId, { name });
			await fetchPeople();
			if (activePerson?.id === personId) {
				const refreshed = people.find((person) => person.id === personId) ?? null;
				if (refreshed) {
					activePerson = refreshed;
					await loadPersonFaces(refreshed);
				} else {
					closePersonDetail();
				}
			}
			toast.add({ title: 'Face moved to a new person' });
		} catch {
			toast.add({ title: 'Failed to create a new person from this face', color: 'error' });
		} finally {
			splittingFaceId = null;
		}
	}

	function closePersonDetail() {
		activePerson = null;
		activePersonFaces = [];
	}

	return {
		get people() {
			return people;
		},
		get loading() {
			return loading;
		},
		get selectedPeople() {
			return selectedPeople;
		},
		get activePerson() {
			return activePerson;
		},
		get activePersonFaces() {
			return activePersonFaces;
		},
		get loadingFaces() {
			return loadingFaces;
		},
		get updatingCoverFaceId() {
			return updatingCoverFaceId;
		},
		get splittingFaceId() {
			return splittingFaceId;
		},
		fetchPeople,
		renamePerson,
		mergePeople,
		loadPersonFaces,
		setPersonCover,
		splitFaceAsNewPerson,
		togglePersonSelection,
		getPersonThumbnailUrl,
		closePersonDetail
	};
}
