import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryPerson, PersonFace } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	people: {
		list: vi.fn(),
		update: vi.fn(),
		merge: vi.fn(),
		listFaces: vi.fn(),
		splitFace: vi.fn(),
		thumbnailUrl: vi.fn(
			(_lib: string, id: string, v?: string) =>
				`/api/libraries/${_lib}/people/${id}/thumbnail${v ? `?v=${encodeURIComponent(v)}` : ''}`
		)
	}
}));

const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

import { createLibraryPeople } from './library-people.svelte';

function makePerson(over: Partial<LibraryPerson> & { id: string }): LibraryPerson {
	return {
		libraryId: 'lib-1',
		name: 'Unknown',
		faceCount: 1,
		coverFaceDetectionId: 'face-1',
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createLibraryPeople — initial state', () => {
	it('starts empty/idle', () => {
		const p = createLibraryPeople(() => 'lib-1');
		expect(p.people).toEqual([]);
		expect(p.loading).toBe(false);
		expect(p.selectedPeople.size).toBe(0);
		expect(p.activePerson).toBeNull();
		expect(p.activePersonFaces).toEqual([]);
		expect(p.loadingFaces).toBe(false);
		expect(p.updatingCoverFaceId).toBeNull();
		expect(p.splittingFaceId).toBeNull();
	});
});

describe('createLibraryPeople — fetchPeople', () => {
	it('loads people and clears loading', async () => {
		const rows = [makePerson({ id: 'a' }), makePerson({ id: 'b' })];
		apiMock.people.list.mockResolvedValue(rows);
		const p = createLibraryPeople(() => 'lib-1');
		await p.fetchPeople();
		expect(apiMock.people.list).toHaveBeenCalledWith('lib-1');
		expect(p.people).toEqual(rows);
		expect(p.loading).toBe(false);
	});

	it('reads the libraryId getter lazily', async () => {
		let id = 'lib-1';
		apiMock.people.list.mockResolvedValue([]);
		const p = createLibraryPeople(() => id);
		id = 'lib-2';
		await p.fetchPeople();
		expect(apiMock.people.list).toHaveBeenCalledWith('lib-2');
	});

	it('toasts when fetching people fails and clears loading', async () => {
		apiMock.people.list.mockRejectedValue(new Error('boom'));
		const p = createLibraryPeople(() => 'lib-1');
		await p.fetchPeople();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to load people', color: 'error' });
		expect(p.loading).toBe(false);
	});
});

describe('createLibraryPeople — renamePerson', () => {
	it('updates the matching person and active person', async () => {
		const person = makePerson({ id: 'person-1', name: 'Unknown' });
		const updated = makePerson({ id: 'person-1', name: 'Alice' });
		apiMock.people.list.mockResolvedValue([person]);
		apiMock.people.listFaces.mockResolvedValue([]);
		apiMock.people.update.mockResolvedValue(updated);
		const p = createLibraryPeople(() => 'lib-1');
		await p.fetchPeople();
		await p.loadPersonFaces(person);
		await p.renamePerson('person-1', 'Alice');
		expect(apiMock.people.update).toHaveBeenCalledWith('lib-1', 'person-1', { name: 'Alice' });
		expect(p.people[0]?.name).toBe('Alice');
		expect(p.activePerson?.name).toBe('Alice');
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Person renamed' });
	});

	it('leaves active person untouched when ids differ', async () => {
		const listed = makePerson({ id: 'person-1', name: 'Unknown' });
		const active = makePerson({ id: 'person-2', name: 'Bob' });
		apiMock.people.list.mockResolvedValue([listed]);
		apiMock.people.listFaces.mockResolvedValue([]);
		apiMock.people.update.mockResolvedValue(makePerson({ id: 'person-1', name: 'Renamed' }));
		const p = createLibraryPeople(() => 'lib-1');
		await p.fetchPeople();
		await p.loadPersonFaces(active);
		await p.renamePerson('person-1', 'Renamed');
		expect(p.people[0]?.name).toBe('Renamed');
		expect(p.activePerson?.id).toBe('person-2');
		expect(p.activePerson?.name).toBe('Bob');
	});

	it('still toasts success when the person is not in the list', async () => {
		const updated = makePerson({ id: 'ghost', name: 'Ghost' });
		apiMock.people.update.mockResolvedValue(updated);
		const p = createLibraryPeople(() => 'lib-1');
		await p.renamePerson('ghost', 'Ghost');
		expect(p.people).toEqual([]);
		expect(p.activePerson).toBeNull();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Person renamed' });
	});

	it('toasts when renaming fails', async () => {
		apiMock.people.update.mockRejectedValue(new Error('boom'));
		const p = createLibraryPeople(() => 'lib-1');
		await p.renamePerson('p1', 'New');
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to rename person',
			color: 'error'
		});
	});
});

describe('createLibraryPeople — selection + merge', () => {
	it('toggles person selection on and off', () => {
		const p = createLibraryPeople(() => 'lib-1');
		p.togglePersonSelection('p1');
		expect(p.selectedPeople.has('p1')).toBe(true);
		p.togglePersonSelection('p1');
		expect(p.selectedPeople.has('p1')).toBe(false);
	});

	it('does nothing when merging fewer than two people', async () => {
		const p = createLibraryPeople(() => 'lib-1');
		p.togglePersonSelection('p1');
		await p.mergePeople();
		expect(apiMock.people.merge).not.toHaveBeenCalled();
	});

	it('merges selected people then clears selection and refetches', async () => {
		apiMock.people.merge.mockResolvedValue(undefined);
		apiMock.people.list.mockResolvedValue([]);
		const p = createLibraryPeople(() => 'lib-1');
		p.togglePersonSelection('p1');
		p.togglePersonSelection('p2');
		await p.mergePeople();
		expect(apiMock.people.merge).toHaveBeenCalledWith('lib-1', { personIds: ['p1', 'p2'] });
		expect(p.selectedPeople.size).toBe(0);
		expect(apiMock.people.list).toHaveBeenCalledWith('lib-1');
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'People merged' });
	});

	it('toasts when merging fails', async () => {
		apiMock.people.merge.mockRejectedValue(new Error('boom'));
		const p = createLibraryPeople(() => 'lib-1');
		p.togglePersonSelection('p1');
		p.togglePersonSelection('p2');
		await p.mergePeople();
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to merge people',
			color: 'error'
		});
	});
});

describe('createLibraryPeople — loadPersonFaces', () => {
	it('sets the active person, loads faces, clears loading', async () => {
		const person = makePerson({ id: 'p1' });
		const faces: PersonFace[] = [{ id: 'f1' } as PersonFace];
		apiMock.people.listFaces.mockResolvedValue(faces);
		const p = createLibraryPeople(() => 'lib-1');
		await p.loadPersonFaces(person);
		expect(apiMock.people.listFaces).toHaveBeenCalledWith('lib-1', 'p1');
		expect(p.activePerson?.id).toBe('p1');
		expect(p.activePersonFaces).toEqual(faces);
		expect(p.loadingFaces).toBe(false);
	});

	it('toasts when loading faces fails and clears loading', async () => {
		apiMock.people.listFaces.mockRejectedValue(new Error('boom'));
		const p = createLibraryPeople(() => 'lib-1');
		await p.loadPersonFaces(makePerson({ id: 'p1' }));
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to load faces', color: 'error' });
		expect(p.loadingFaces).toBe(false);
	});
});

describe('createLibraryPeople — getPersonThumbnailUrl', () => {
	it('busts cache with the cover face id when present', () => {
		const p = createLibraryPeople(() => 'lib-1');
		const withCover = makePerson({ id: 'person-1', coverFaceDetectionId: 'face-123' });
		expect(p.getPersonThumbnailUrl(withCover)).toBe(
			'/api/libraries/lib-1/people/person-1/thumbnail?v=face-123'
		);
		expect(apiMock.people.thumbnailUrl).toHaveBeenCalledWith('lib-1', 'person-1', 'face-123');
	});

	it('falls back to updatedAt when there is no cover face', () => {
		const p = createLibraryPeople(() => 'lib-1');
		const withoutCover = makePerson({
			id: 'person-2',
			coverFaceDetectionId: null,
			updatedAt: '2025-01-10T12:00:00Z'
		});
		expect(p.getPersonThumbnailUrl(withoutCover)).toBe(
			'/api/libraries/lib-1/people/person-2/thumbnail?v=2025-01-10T12%3A00%3A00Z'
		);
		expect(apiMock.people.thumbnailUrl).toHaveBeenCalledWith(
			'lib-1',
			'person-2',
			'2025-01-10T12:00:00Z'
		);
	});
});

describe('createLibraryPeople — setPersonCover', () => {
	it('updates people + active person state and clears the updating flag', async () => {
		const person = makePerson({ id: 'person-1', coverFaceDetectionId: 'face-1' });
		const updated = makePerson({
			id: 'person-1',
			coverFaceDetectionId: 'face-2',
			updatedAt: '2025-01-02T00:00:00Z'
		});
		apiMock.people.list.mockResolvedValue([person]);
		apiMock.people.listFaces.mockResolvedValue([]);
		apiMock.people.update.mockResolvedValue(updated);

		const p = createLibraryPeople(() => 'lib-1');
		await p.fetchPeople();
		await p.loadPersonFaces(person);

		await p.setPersonCover('person-1', 'face-2');

		expect(apiMock.people.update).toHaveBeenCalledWith('lib-1', 'person-1', {
			coverFaceDetectionId: 'face-2'
		});
		expect(p.people[0]?.coverFaceDetectionId).toBe('face-2');
		expect(p.activePerson?.coverFaceDetectionId).toBe('face-2');
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Cover photo updated' });
		expect(p.updatingCoverFaceId).toBeNull();
	});

	it('still toasts success when the person is not in the list', async () => {
		const updated = makePerson({ id: 'ghost', coverFaceDetectionId: 'face-9' });
		apiMock.people.update.mockResolvedValue(updated);
		const p = createLibraryPeople(() => 'lib-1');
		await p.setPersonCover('ghost', 'face-9');
		expect(p.people).toEqual([]);
		expect(p.activePerson).toBeNull();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Cover photo updated' });
		expect(p.updatingCoverFaceId).toBeNull();
	});

	it('toasts when setting the cover photo fails and clears the flag', async () => {
		apiMock.people.update.mockRejectedValue(new Error('boom'));
		const p = createLibraryPeople(() => 'lib-1');
		await p.setPersonCover('p1', 'face-9');
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to update cover photo',
			color: 'error'
		});
		expect(p.updatingCoverFaceId).toBeNull();
	});
});

describe('createLibraryPeople — splitFaceAsNewPerson', () => {
	it('refreshes people and reloads active person faces', async () => {
		const person = makePerson({ id: 'person-1', name: 'Taylor', faceCount: 2 });
		const refreshedPerson = makePerson({ id: 'person-1', name: 'Taylor', faceCount: 1 });

		apiMock.people.splitFace.mockResolvedValue(undefined);
		apiMock.people.list.mockResolvedValueOnce([person]); // initial fetch
		apiMock.people.listFaces.mockResolvedValueOnce([]); // initial loadPersonFaces
		apiMock.people.list.mockResolvedValueOnce([refreshedPerson]); // post-split fetch
		apiMock.people.listFaces.mockResolvedValueOnce([]); // post-split loadPersonFaces

		const p = createLibraryPeople(() => 'lib-1');
		await p.fetchPeople();
		await p.loadPersonFaces(person);

		await p.splitFaceAsNewPerson('person-1', 'face-2', 'Jordan');

		expect(apiMock.people.splitFace).toHaveBeenCalledWith('lib-1', 'person-1', 'face-2', {
			name: 'Jordan'
		});
		expect(apiMock.people.list).toHaveBeenLastCalledWith('lib-1');
		expect(apiMock.people.listFaces).toHaveBeenLastCalledWith('lib-1', 'person-1');
		expect(p.people[0]?.faceCount).toBe(1);
		expect(p.activePerson?.faceCount).toBe(1);
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Face moved to a new person' });
		expect(p.splittingFaceId).toBeNull();
	});

	it('does not reload faces when the active person differs', async () => {
		apiMock.people.splitFace.mockResolvedValue(undefined);
		apiMock.people.list.mockResolvedValue([]);
		const p = createLibraryPeople(() => 'lib-1');
		await p.splitFaceAsNewPerson('person-1', 'face-2');
		expect(apiMock.people.listFaces).not.toHaveBeenCalled();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Face moved to a new person' });
	});

	it('closes the detail view when the split person no longer exists', async () => {
		const person = makePerson({ id: 'p1' });
		apiMock.people.splitFace.mockResolvedValue(undefined);
		apiMock.people.list.mockResolvedValueOnce([person]); // initial fetch
		apiMock.people.listFaces.mockResolvedValueOnce([]); // initial loadPersonFaces
		apiMock.people.list.mockResolvedValueOnce([]); // post-split: person gone

		const p = createLibraryPeople(() => 'lib-1');
		await p.fetchPeople();
		await p.loadPersonFaces(person);

		await p.splitFaceAsNewPerson('p1', 'face-3');

		expect(p.activePerson).toBeNull();
		expect(p.activePersonFaces).toEqual([]);
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Face moved to a new person' });
	});

	it('toasts when splitting a face fails and clears the flag', async () => {
		apiMock.people.splitFace.mockRejectedValue(new Error('boom'));
		const p = createLibraryPeople(() => 'lib-1');
		await p.splitFaceAsNewPerson('p1', 'face-3');
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to create a new person from this face',
			color: 'error'
		});
		expect(p.splittingFaceId).toBeNull();
	});
});

describe('createLibraryPeople — closePersonDetail', () => {
	it('clears the active person and faces', async () => {
		const person = makePerson({ id: 'p1' });
		apiMock.people.listFaces.mockResolvedValue([{ id: 'f1' } as PersonFace]);
		const p = createLibraryPeople(() => 'lib-1');
		await p.loadPersonFaces(person);
		expect(p.activePerson).not.toBeNull();
		p.closePersonDetail();
		expect(p.activePerson).toBeNull();
		expect(p.activePersonFaces).toEqual([]);
	});
});
