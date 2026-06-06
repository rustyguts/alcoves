import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Library, ObjectLabel } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1' },
		url: new URL('http://localhost/libraries/lib-1/objects'),
		data: {}
	}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

// ─── portal action: keep the toolbar node in place so we can assert on it ─────
vi.mock('$lib/actions/portal', () => ({
	portal: () => ({ update() {}, destroy() {} })
}));

// ─── toast ───────────────────────────────────────────────────────────────────
const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn()
}));
vi.mock('$lib/state/toast', () => ({ toast: toastMock }));

// ─── api mock ─────────────────────────────────────────────────────────────────
// The page calls api.objects.labels on mount and api.objects.reprocess on click.
const state = vi.hoisted(() => ({
	labels: [] as ObjectLabel[]
}));

const apiMock = vi.hoisted(() => ({
	objects: {
		labels: vi.fn(),
		reprocess: vi.fn()
	}
}));
vi.mock('$lib/api', () => ({ api: apiMock }));

import Page from './+page.svelte';

const owner = {
	id: 'u1',
	email: 'owner@example.com',
	displayName: 'Owner',
	avatarUrl: null,
	role: 'owner' as const,
	createdAt: '2025-01-01T00:00:00Z',
	updatedAt: '2025-01-01T00:00:00Z'
};

const viewer = { ...owner, id: 'u2', role: 'member' };

function makeLibrary(over: Partial<Library> = {}): Library {
	return {
		id: 'lib-1',
		name: 'Family',
		ownerId: 'u1',
		currentUserRole: 'owner',
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		...over
	} as Library;
}

// data merged from the (app) + library subtree layout loads. Cast to satisfy the
// generated PageProps shape (mirrors the (app)/+page test convention).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function props(over: { library?: Library; user?: { id: string; role: string } } = {}): any {
	return {
		data: {
			user: over.user ?? owner,
			libraries: [],
			library: over.library ?? makeLibrary()
		}
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	state.labels = [];
	apiMock.objects.labels.mockImplementation(async () => ({ labels: state.labels }));
	apiMock.objects.reprocess.mockResolvedValue({ queuedCount: 3 });
});

describe('/libraries/[id]/objects', () => {
	it('loads object labels on mount', async () => {
		render(Page, { props: props() });
		await tick();
		expect(apiMock.objects.labels).toHaveBeenCalledWith('lib-1');
	});

	it('shows the empty state when there are no labels', async () => {
		const screen = render(Page, { props: props() });
		await expect.element(screen.getByText('No objects detected yet')).toBeInTheDocument();
	});

	it('renders the labels table with badges and counts', async () => {
		state.labels = [
			{ label: 'person', fileCount: 12 },
			{ label: 'dog', fileCount: 5 }
		];
		const screen = render(Page, { props: props() });

		await expect.element(screen.getByText('person')).toBeInTheDocument();
		await expect.element(screen.getByText('dog')).toBeInTheDocument();
		// Summary badges: 2 labels, 17 total detections.
		await expect.element(screen.getByText('2 labels')).toBeInTheDocument();
		await expect.element(screen.getByText('17 total detections')).toBeInTheDocument();
	});

	it('shows a Reprocess button for managers and queues a reprocess on click', async () => {
		const screen = render(Page, { props: props() });
		const btn = screen.getByRole('button', { name: /Reprocess/ });
		await expect.element(btn).toBeInTheDocument();

		await btn.click();
		expect(apiMock.objects.reprocess).toHaveBeenCalledWith('lib-1');
		expect(toastMock.add).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Reprocessing queued' })
		);
	});

	it('hides the Reprocess button for non-managers', async () => {
		const screen = render(Page, {
			props: props({
				user: viewer,
				library: makeLibrary({ ownerId: 'u1', currentUserRole: 'viewer' })
			})
		});
		await tick();
		await expect.element(screen.getByText('No objects detected yet')).toBeInTheDocument();
		expect(screen.container.querySelector('button')).toBeNull();
	});

	it('surfaces an error toast when reprocess fails', async () => {
		apiMock.objects.reprocess.mockRejectedValueOnce(new Error('boom'));
		const screen = render(Page, { props: props() });
		const btn = screen.getByRole('button', { name: /Reprocess/ });
		await btn.click();
		expect(toastMock.error).toHaveBeenCalledWith('boom');
	});
});
