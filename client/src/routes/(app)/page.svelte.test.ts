import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';
import type { AuthUser } from '$lib/types/api';

const user: AuthUser = {
	id: 'u1',
	email: 'test@alcoves.io',
	displayName: 'Test',
	avatarUrl: null,
	role: 'owner'
};

const { gotoMock, invalidateAllMock, createMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	invalidateAllMock: vi.fn().mockResolvedValue(undefined),
	createMock: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock, invalidateAll: invalidateAllMock }));
vi.mock('$app/state', () => ({
	page: { params: {}, url: new URL('http://localhost/'), data: {} }
}));
vi.mock('$lib/api', () => ({ api: { libraries: { create: createMock } } }));

const toastError = vi.fn();
vi.mock('$lib/state/toast', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

// `data` is merged from the (app) layout load (user + libraries). The page only
// reads `data.libraries`; cast to satisfy the generated PageProps shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const emptyProps = { data: { user, libraries: [] } } as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withLibrariesProps = { data: { user, libraries: [{ id: 'L1' }] } } as any;

beforeEach(() => {
	gotoMock.mockReset();
	invalidateAllMock.mockReset().mockResolvedValue(undefined);
	createMock.mockReset();
	toastError.mockReset();
});

describe('(app) home page — empty state', () => {
	it('renders the create-first-library state when there are no libraries', async () => {
		const screen = render(Page, { props: emptyProps });
		await expect.element(screen.getByText('Welcome to Alcoves')).toBeInTheDocument();
		await expect.element(screen.getByLabelText('Library name')).toBeInTheDocument();
		await expect.element(screen.getByText('Create library')).toBeInTheDocument();
	});

	it('renders nothing when libraries exist (load would have redirected)', () => {
		const screen = render(Page, { props: withLibrariesProps });
		expect(screen.container.textContent).not.toContain('Welcome to Alcoves');
	});

	it('creates the library and navigates to it on submit', async () => {
		createMock.mockResolvedValue({ id: 'new-lib' });
		const screen = render(Page, { props: emptyProps });

		await screen.getByLabelText('Library name').fill('Family Photos');
		await screen.getByText('Create library').click();

		await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: 'Family Photos' }));
		await vi.waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
		await vi.waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/libraries/new-lib'));
	});

	it('shows an error toast and does not navigate when creation fails', async () => {
		createMock.mockRejectedValue(new Error('boom'));
		const screen = render(Page, { props: emptyProps });

		await screen.getByLabelText('Library name').fill('Oops');
		await screen.getByText('Create library').click();

		await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(gotoMock).not.toHaveBeenCalled();
	});
});
