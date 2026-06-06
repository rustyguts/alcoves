import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { AuthUser, Library } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
// The wrapper itself reads nothing from $app, but its $types import + the mocked
// child resolve cleanly with these in place.
vi.mock('$app/state', () => ({
	page: {
		params: { id: 'lib-1' },
		url: new URL('http://localhost/libraries/lib-1/trash'),
		data: {}
	}
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

// ─── LibraryBrowser stub ─────────────────────────────────────────────────────
// Swap the heavy shared browser for a lightweight test double that records the
// props the trash page forwards. This keeps the wrapper's coverage isolated from
// the real component's store/API graph.
vi.mock('../LibraryBrowser.svelte', async () => ({
	default: (await import('./MockLibraryBrowser.svelte')).default
}));

import Page from './+page.svelte';

const library: Library = {
	id: 'lib-1',
	name: 'Test Library',
	emoji: null,
	isDefault: false,
	faceRecognitionEnabled: false,
	ownerId: 'user-1',
	currentUserRole: 'owner',
	createdAt: '2024-01-01',
	updatedAt: '2024-01-01'
} as Library;

const user = { id: 'user-1', email: 'owner@x.io', displayName: 'Owner', role: 'owner' } as AuthUser;

function renderPage(data: { library: Library | null; user: AuthUser | null }) {
	return render(Page, {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		props: { data } as any
	});
}

describe('/libraries/[id]/trash (browser)', () => {
	it('renders the shared LibraryBrowser with trashed enabled', async () => {
		const screen = renderPage({ library, user });

		const browser = screen.container.querySelector('[data-testid="mock-library-browser"]');
		expect(browser).not.toBeNull();
		expect(browser?.getAttribute('data-trashed')).toBe('true');
	});

	it('forwards the library and user from page data', async () => {
		const screen = renderPage({ library, user });

		const browser = screen.container.querySelector('[data-testid="mock-library-browser"]');
		expect(browser?.getAttribute('data-library-id')).toBe('lib-1');
		expect(browser?.getAttribute('data-user-id')).toBe('user-1');
	});

	it('still mounts when library and user are absent', async () => {
		const screen = renderPage({ library: null, user: null });

		const browser = screen.container.querySelector('[data-testid="mock-library-browser"]');
		expect(browser).not.toBeNull();
		expect(browser?.getAttribute('data-trashed')).toBe('true');
		expect(browser?.getAttribute('data-library-id')).toBe('');
		expect(browser?.getAttribute('data-user-id')).toBe('');
	});
});
