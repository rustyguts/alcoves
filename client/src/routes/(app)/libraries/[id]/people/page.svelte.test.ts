import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryPerson } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1' },
		url: new URL('http://localhost/libraries/lib-1/people'),
		data: {}
	}
}));

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => goto(...a) }));

// ─── library-people store mock ───────────────────────────────────────────────
// A reactive fake so the page's {#if people.*} branches and the merge bar update
// when the test flips state.
const peopleState = vi.hoisted(() => ({
	people: [] as LibraryPerson[],
	loading: false,
	selectedPeople: new Set<string>(),
	fetchPeople: vi.fn(),
	renamePerson: vi.fn(),
	mergePeople: vi.fn(),
	togglePersonSelection: vi.fn((id: string) => {
		const next = new Set(peopleState.selectedPeople);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		peopleState.selectedPeople = next;
	}),
	getPersonThumbnailUrl: vi.fn((p: LibraryPerson) => `/thumb/${p.id}`)
}));

vi.mock('$lib/state/library-people.svelte', () => ({
	createLibraryPeople: vi.fn(() => ({
		get people() {
			return peopleState.people;
		},
		get loading() {
			return peopleState.loading;
		},
		get selectedPeople() {
			return peopleState.selectedPeople;
		},
		fetchPeople: peopleState.fetchPeople,
		renamePerson: peopleState.renamePerson,
		mergePeople: peopleState.mergePeople,
		togglePersonSelection: peopleState.togglePersonSelection,
		getPersonThumbnailUrl: peopleState.getPersonThumbnailUrl
	}))
}));

import Page from './+page.svelte';

function makePerson(id: string, over: Partial<LibraryPerson> = {}): LibraryPerson {
	return {
		id,
		libraryId: 'lib-1',
		name: null,
		faceCount: 3,
		coverFaceDetectionId: null,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	peopleState.people = [];
	peopleState.loading = false;
	peopleState.selectedPeople = new Set<string>();
});

describe('/libraries/[id]/people', () => {
	it('fetches people on mount', async () => {
		render(Page);
		await tick();
		expect(peopleState.fetchPeople).toHaveBeenCalled();
	});

	it('shows the loading spinner while loading', async () => {
		peopleState.loading = true;
		const screen = render(Page);
		await tick();
		// The spinner is the only icon rendered in the loading branch.
		expect(screen.container.querySelector('.animate-spin')).toBeTruthy();
	});

	it('shows the empty state when there are no people', async () => {
		const screen = render(Page);
		await expect.element(screen.getByText('No faces detected yet')).toBeInTheDocument();
	});

	it('renders a tile per person with face count and name', async () => {
		peopleState.people = [makePerson('p1', { name: 'Alex', faceCount: 7 }), makePerson('p2')];
		const screen = render(Page);
		await expect.element(screen.getByText('Alex')).toBeInTheDocument();
		await expect.element(screen.getByText('7')).toBeInTheDocument();
		// Unnamed person falls back to the title attribute.
		expect(screen.container.querySelector('button[title="Unnamed person"]')).toBeTruthy();
		// Thumbnail URL comes from the store helper.
		expect(peopleState.getPersonThumbnailUrl).toHaveBeenCalled();
	});

	it('toggles selection when a tile is clicked', async () => {
		peopleState.people = [makePerson('p1', { name: 'Alex' })];
		const screen = render(Page);
		await screen.getByText('Alex').click();
		expect(peopleState.togglePersonSelection).toHaveBeenCalledWith('p1');
	});

	it('shows the merge bar once two or more people are selected and merges', async () => {
		peopleState.people = [makePerson('p1', { name: 'Alex' }), makePerson('p2', { name: 'Bea' })];
		peopleState.selectedPeople = new Set(['p1', 'p2']);
		const screen = render(Page);

		await expect.element(screen.getByText('2 selected')).toBeInTheDocument();
		await screen.getByRole('button', { name: 'Merge Selected' }).click();
		expect(peopleState.mergePeople).toHaveBeenCalled();
	});

	it('clear button deselects every selected person', async () => {
		peopleState.people = [makePerson('p1', { name: 'Alex' }), makePerson('p2', { name: 'Bea' })];
		peopleState.selectedPeople = new Set(['p1', 'p2']);
		const screen = render(Page);

		await screen.getByRole('button', { name: 'Clear' }).click();
		expect(peopleState.togglePersonSelection).toHaveBeenCalledWith('p1');
		expect(peopleState.togglePersonSelection).toHaveBeenCalledWith('p2');
	});

	it('navigates to the person detail on double-click', async () => {
		peopleState.people = [makePerson('p1', { name: 'Alex' })];
		const screen = render(Page);
		const tile = screen.container.querySelector('button[title="Alex"]') as HTMLButtonElement;
		expect(tile).toBeTruthy();
		tile.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await tick();
		expect(goto).toHaveBeenCalledWith('/libraries/lib-1/people/p1');
	});

	it('opens the rename modal on right-click and renames via Save', async () => {
		peopleState.people = [makePerson('p1', { name: 'Alex' })];
		const screen = render(Page);
		const tile = screen.container.querySelector('button[title="Alex"]') as HTMLButtonElement;
		tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

		// The Skeleton Dialog content mounts on a macrotask.
		await tick();
		await new Promise((r) => setTimeout(r, 0));
		await tick();

		const save = screen.getByRole('button', { name: 'Save' });
		await expect.element(save).toBeInTheDocument();
		await save.click();
		expect(peopleState.renamePerson).toHaveBeenCalledWith('p1', 'Alex');
	});
});
