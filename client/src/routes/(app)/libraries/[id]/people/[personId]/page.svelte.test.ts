import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryPerson, PersonFace } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1', personId: 'p1' },
		url: new URL('http://localhost/libraries/lib-1/people/p1'),
		data: { library: { id: 'lib-1', name: 'Family Photos' }, user: { id: 'u1' } }
	}
}));

const goto = vi.fn();
vi.mock('$app/navigation', () => ({
	goto: (...a: unknown[]) => goto(...a),
	invalidateAll: vi.fn()
}));

// ─── library-people store mock ───────────────────────────────────────────────
// A reactive fake mirroring createLibraryPeople's getter surface. Tests mutate
// the backing object to drive the page's branches; the mutators reflect into it.
const store = vi.hoisted(() => {
	const s = {
		people: [] as LibraryPerson[],
		activePerson: null as LibraryPerson | null,
		activePersonFaces: [] as PersonFace[],
		loadingFaces: false,
		updatingCoverFaceId: null as string | null,
		splittingFaceId: null as string | null,
		fetchPeople: vi.fn(async () => {}),
		loadPersonFaces: vi.fn(async (person: LibraryPerson) => {
			s.activePerson = person;
		}),
		setPersonCover: vi.fn(async () => {}),
		splitFaceAsNewPerson: vi.fn(async () => {}),
		closePersonDetail: vi.fn(() => {
			s.activePerson = null;
			s.activePersonFaces = [];
		})
	};
	return s;
});

const createLibraryPeople = vi.hoisted(() => vi.fn<(getId: () => string) => void>());

vi.mock('$lib/state/library-people.svelte', () => ({
	createLibraryPeople: (getId: () => string) => {
		createLibraryPeople(getId);
		return {
			get people() {
				return store.people;
			},
			get activePerson() {
				return store.activePerson;
			},
			get activePersonFaces() {
				return store.activePersonFaces;
			},
			get loadingFaces() {
				return store.loadingFaces;
			},
			get updatingCoverFaceId() {
				return store.updatingCoverFaceId;
			},
			get splittingFaceId() {
				return store.splittingFaceId;
			},
			fetchPeople: store.fetchPeople,
			loadPersonFaces: store.loadPersonFaces,
			setPersonCover: store.setPersonCover,
			splitFaceAsNewPerson: store.splitFaceAsNewPerson,
			closePersonDetail: store.closePersonDetail
		};
	}
}));

// ─── api mock (files.get for the face preview) ───────────────────────────────
const filesGet = vi.hoisted(() =>
	vi.fn<(libraryId: string, fileId: string) => Promise<{ id: string }>>(async (_l, fileId) => ({
		id: fileId
	}))
);
vi.mock('$lib/api', () => ({
	api: { files: { get: (libraryId: string, fileId: string) => filesGet(libraryId, fileId) } },
	apiUrl: (p: string) => p
}));

// ─── toast mock ──────────────────────────────────────────────────────────────
const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('$lib/state/toast', () => ({ toast: { add: (...a: unknown[]) => toastAdd(...a) } }));

// FilePreview pulls in image-proxy / fetch plumbing — stub it to a marker so the
// page test stays focused on people behaviour.
vi.mock('$lib/components/FilePreview.svelte', async () => {
	const Stub = (await import('./preview-stub.svelte')).default;
	return { default: Stub };
});

// AlcovesImage renders an <img> hitting the proxy — stub to a plain marker img.
vi.mock('$lib/components/ui/AlcovesImage.svelte', async () => {
	const Stub = (await import('./image-stub.svelte')).default;
	return { default: Stub };
});

import Page from './+page.svelte';

function makeFace(id: string, over: Partial<PersonFace> = {}): PersonFace {
	return {
		id,
		fileId: `file-${id}`,
		fileName: `${id}.jpg`,
		boxX: 0,
		boxY: 0,
		boxWidth: 10,
		boxHeight: 10,
		imageWidth: 100,
		imageHeight: 100,
		confidence: 0.99,
		createdAt: '2026-06-04T12:00:00Z',
		...over
	};
}

function makePerson(over: Partial<LibraryPerson> = {}): LibraryPerson {
	return {
		id: 'p1',
		libraryId: 'lib-1',
		name: 'Alice',
		faceCount: 2,
		coverFaceDetectionId: null,
		createdAt: '2026-06-04T12:00:00Z',
		updatedAt: '2026-06-04T12:00:00Z',
		...over
	};
}

function resetStore() {
	store.people = [];
	store.activePerson = null;
	store.activePersonFaces = [];
	store.loadingFaces = false;
	store.updatingCoverFaceId = null;
	store.splittingFaceId = null;
	store.fetchPeople.mockClear();
	store.loadPersonFaces.mockClear();
	store.setPersonCover.mockClear();
	store.splitFaceAsNewPerson.mockClear();
	store.closePersonDetail.mockClear();
	createLibraryPeople.mockClear();
	filesGet.mockClear();
	toastAdd.mockClear();
	goto.mockClear();
}

beforeEach(() => {
	resetStore();
});

describe('person detail page', () => {
	it('instantiates the people store with a libraryId getter', () => {
		render(Page);
		expect(createLibraryPeople).toHaveBeenCalledTimes(1);
		const getter = createLibraryPeople.mock.calls[0]![0] as () => string;
		expect(getter()).toBe('lib-1');
	});

	it("fetches people then loads the matching person's faces on mount", async () => {
		const person = makePerson();
		store.people = [person];
		store.fetchPeople.mockImplementation(async () => {
			store.activePerson = person;
			store.activePersonFaces = [makeFace('a')];
		});

		render(Page);
		await tick();

		expect(store.fetchPeople).toHaveBeenCalledTimes(1);
		expect(store.loadPersonFaces).toHaveBeenCalledWith(person);
	});

	it('renders the person label and face count', async () => {
		store.activePerson = makePerson({ name: 'Alice' });
		store.activePersonFaces = [makeFace('a'), makeFace('b')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [store.activePerson!];
		});

		const screen = render(Page);

		await expect.element(screen.getByText('Alice')).toBeInTheDocument();
		await expect.element(screen.getByText('2 faces')).toBeInTheDocument();
	});

	it('shows the not-found state when the person is missing', async () => {
		store.people = [];
		store.activePerson = null;

		const screen = render(Page);

		await expect.element(screen.getByText('Person not found')).toBeInTheDocument();
		const back = screen.getByRole('button', { name: 'Back to People' });
		await back.click();
		expect(goto).toHaveBeenCalledWith('/libraries/lib-1/people');
	});

	it('shows the empty-faces state', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await expect.element(screen.getByText('No faces available')).toBeInTheDocument();
	});

	it('renders a tile per face and opens the file preview on click', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a'), makeFace('b')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		// onMount fetches people then loads faces (async) before the grid renders.
		await vi.waitFor(() =>
			expect(screen.container.querySelectorAll('[data-testid="image-stub"]')).toHaveLength(2)
		);
		const tiles = screen.container.querySelectorAll('[data-testid="image-stub"]');

		// No preview until a tile is clicked.
		expect(screen.container.querySelector('[data-testid="preview-stub"]')).toBeNull();
		await tiles[0]!.parentElement!.click();
		expect(filesGet).toHaveBeenCalledWith('lib-1', 'file-a');
		await expect.element(screen.getByTestId('preview-stub')).toBeInTheDocument();
	});

	it('opens the face context menu and updates the cover photo', async () => {
		const person = makePerson();
		const face = makeFace('a');
		store.activePerson = person;
		store.activePersonFaces = [face];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();

		const coverBtn = screen.getByRole('menuitem', { name: 'Update cover photo' });
		await expect.element(coverBtn).toBeInTheDocument();
		await coverBtn.click();
		expect(store.setPersonCover).toHaveBeenCalledWith('p1', 'a');
	});

	it('splits a face into a new person from the context menu', async () => {
		const person = makePerson();
		const face = makeFace('a');
		store.activePerson = person;
		store.activePersonFaces = [face];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();

		const newPersonBtn = screen.getByRole('menuitem', { name: 'New person' });
		await newPersonBtn.click();
		expect(store.splitFaceAsNewPerson).toHaveBeenCalledWith('p1', 'a');
	});

	it('falls back to "Unnamed person" when the person has no name', async () => {
		const person = makePerson({ name: '   ' });
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await expect.element(screen.getByText('Unnamed person')).toBeInTheDocument();
		await expect.element(screen.getByText('1 face')).toBeInTheDocument();
	});

	it('shows the loading spinner while faces are loading', async () => {
		store.loadingFaces = true;
		store.activePerson = makePerson();
		store.activePersonFaces = [];

		const screen = render(Page);

		await vi.waitFor(() => expect(screen.container.querySelector('.animate-spin')).not.toBeNull());
	});

	it('closes the person detail when the person is not in the fetched list', async () => {
		// fetchPeople resolves but the requested personId is absent → closePersonDetail.
		store.fetchPeople.mockImplementation(async () => {
			store.people = [makePerson({ id: 'someone-else' })];
		});

		render(Page);
		await vi.waitFor(() => expect(store.closePersonDetail).toHaveBeenCalledTimes(1));
		expect(store.loadPersonFaces).not.toHaveBeenCalled();
	});

	it('toasts when loading the person fails', async () => {
		store.fetchPeople.mockRejectedValueOnce(new Error('boom'));

		render(Page);
		await vi.waitFor(() =>
			expect(toastAdd).toHaveBeenCalledWith({ title: 'Failed to load person', color: 'error' })
		);
	});

	it('serves the file preview from cache on a second open without refetching', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;

		await tile.click();
		await expect.element(screen.getByTestId('preview-stub')).toBeInTheDocument();
		expect(filesGet).toHaveBeenCalledTimes(1);

		// Re-opening the same crop's file hits the cache: no second fetch.
		await tile.click();
		await tick();
		expect(filesGet).toHaveBeenCalledTimes(1);
	});

	it('toasts when the file preview fetch fails', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});
		filesGet.mockRejectedValueOnce(new Error('nope'));

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		await tile.click();

		await vi.waitFor(() =>
			expect(toastAdd).toHaveBeenCalledWith({
				title: 'Failed to load file preview',
				color: 'error'
			})
		);
		expect(screen.container.querySelector('[data-testid="preview-stub"]')).toBeNull();
	});

	it('forwards adjacent-file navigation from the preview', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		await tile.click();
		await expect.element(screen.getByTestId('preview-stub')).toBeInTheDocument();
		expect(screen.getByTestId('preview-file-id').element().textContent).toBe('file-a');

		await screen.getByTestId('preview-navigate').click();
		await vi.waitFor(() =>
			expect(screen.getByTestId('preview-file-id').element().textContent).toBe('navigated')
		);
	});

	it('shows a spinner overlay on the crop being set as cover', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a'), makeFace('b')];
		store.updatingCoverFaceId = 'a';
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelectorAll('[data-testid="image-stub"]')).toHaveLength(2)
		);
		// Exactly the cover-target crop overlays a spinner (bg-black/40 wrapper).
		await vi.waitFor(() =>
			expect(screen.container.querySelectorAll('.bg-black\\/40')).toHaveLength(1)
		);
	});

	it('shows a spinner overlay on the crop being split', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a'), makeFace('b')];
		store.splittingFaceId = 'b';
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelectorAll('.bg-black\\/40')).toHaveLength(1)
		);
	});

	// Dismissal-on-outside-interaction (click/contextmenu-inside-doesn't-close) is
	// now bits-ui's ContextMenu behavior — the ContextMenu.Root wrapping the face
	// grid owns it, replacing the old hand-rolled window click/stopPropagation
	// listeners. Escape is the reliable, synthesizable way to exercise "the menu
	// can be dismissed" without reproducing bits-ui's internal outside-pointerdown
	// geometry/debounce heuristics in a unit test (see the identical precedent +
	// rationale in routes/(app)/libraries/[id]/page.svelte.test.ts).
	it('Escape closes an open context menu', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();
		await tick();
		const menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();

		menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await vi.waitFor(() => {
			expect(document.querySelector('[role="menu"]')).toBeNull();
		});
	});

	it('returns to the people list after splitting empties the active person', async () => {
		const person = makePerson();
		const face = makeFace('a');
		store.activePerson = person;
		store.activePersonFaces = [face];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});
		// The split clears the active person's faces → page falls back to the list.
		store.splitFaceAsNewPerson.mockImplementation(async () => {
			store.activePersonFaces = [];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();

		await screen.getByRole('menuitem', { name: 'New person' }).click();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/libraries/lib-1/people'));
	});

	// F5/F14/F20 regression: a single ContextMenu.Root+Trigger wraps the whole
	// face grid, so right-clicking a gap (never any tile) used to still open
	// bits-ui's menu — with whatever face was last recorded, or silently
	// no-op items on a fresh visit. The trigger-level guard should leave gap
	// right-clicks un-prevented (native browser menu) instead of opening.
	it('does not open the context menu when right-clicking a grid gap', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a'), makeFace('b')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelectorAll('[data-testid="image-stub"]')).toHaveLength(2)
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		const grid = tile.parentElement!;

		const gapEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		grid.dispatchEvent(gapEvent);
		await tick();

		expect(document.querySelector('[role="menu"]')).toBeNull();
		// Left un-prevented so the native browser context menu is free to show.
		expect(gapEvent.defaultPrevented).toBe(false);
	});

	it('does not reopen a stale menu targeting the previous face when right-clicking a grid gap', async () => {
		const person = makePerson();
		const faceA = makeFace('a');
		const faceB = makeFace('b');
		store.activePerson = person;
		store.activePersonFaces = [faceA, faceB];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelectorAll('[data-testid="image-stub"]')).toHaveLength(2)
		);
		const tiles = screen.container.querySelectorAll('[data-testid="image-stub"]');
		const tileA = tiles[0]!.parentElement!;
		const grid = tileA.parentElement!;

		// Right-click face A, then dismiss the menu (Escape).
		tileA.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();
		const menu = document.querySelector('[role="menu"]');
		expect(menu).not.toBeNull();
		menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());

		// Right-clicking the grid gap must NOT reopen a menu wired to face A.
		const gapEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		grid.dispatchEvent(gapEvent);
		await tick();
		expect(document.querySelector('[role="menu"]')).toBeNull();
		expect(gapEvent.defaultPrevented).toBe(false);

		// A subsequent right-click on the actual second tile still targets the
		// correct face (B), proving menuFace was cleared rather than left on A.
		const tileB = tiles[1]!.parentElement!;
		tileB.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();
		const coverBtn = screen.getByRole('menuitem', { name: 'Update cover photo' });
		await coverBtn.click();
		expect(store.setPersonCover).toHaveBeenCalledWith('p1', 'b');
		expect(store.setPersonCover).not.toHaveBeenCalledWith('p1', 'a');
	});

	it('stays on the page when splitting leaves the person with faces', async () => {
		const person = makePerson();
		store.activePerson = person;
		store.activePersonFaces = [makeFace('a'), makeFace('b')];
		store.fetchPeople.mockImplementation(async () => {
			store.people = [person];
		});
		// Split removes one face but leaves another → no navigation away.
		store.splitFaceAsNewPerson.mockImplementation(async () => {
			store.activePersonFaces = [makeFace('b')];
		});

		const screen = render(Page);

		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="image-stub"]')).not.toBeNull()
		);
		const tile = screen.container.querySelector('[data-testid="image-stub"]')!.parentElement!;
		tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await tick();

		await screen.getByRole('menuitem', { name: 'New person' }).click();
		await tick();
		expect(goto).not.toHaveBeenCalled();
	});
});
