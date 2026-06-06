import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';

// The layout reads the library id + current path from $app/state.page. Tests swap
// the pathname before each render to exercise the timeline `hideHeading` branch.
const pageState = vi.hoisted(() => ({
	params: { id: 'L1' } as Record<string, string>,
	url: new URL('http://localhost/libraries/L1'),
	data: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

import Layout from './+layout.svelte';

const library = { id: 'L1', name: 'Family Photos', emoji: '📸', ownerId: 'u1' };

const renderLayout = () => {
	const children = createRawSnippet(() => ({
		render: () => '<main data-testid="page">tab content</main>'
	}));
	return render(Layout, {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		props: { data: { library }, children } as any
	});
};

beforeEach(() => {
	pageState.params = { id: 'L1' };
	pageState.url = new URL('http://localhost/libraries/L1');
});

describe('(app) libraries/[id] +layout', () => {
	it('renders the library header (name + emoji), the portal target, and the page slot', async () => {
		const screen = renderLayout();

		await expect.element(screen.getByText('Family Photos')).toBeInTheDocument();
		expect(screen.container.textContent).toContain('📸');
		expect(screen.container.querySelector('#library-header-actions')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="page"]')).not.toBeNull();
	});

	it('hides the heading (breadcrumb row) on the timeline tab', async () => {
		pageState.url = new URL('http://localhost/libraries/L1/timeline');
		const screen = renderLayout();

		// Heading row gone → the library name (and the portal target that lives in
		// the heading's actions area) are dropped, but the page slot still renders.
		expect(screen.container.textContent).not.toContain('Family Photos');
		expect(screen.container.querySelector('#library-header-actions')).toBeNull();
		expect(screen.container.querySelector('[data-testid="page"]')).not.toBeNull();
	});

	it("falls back to '' when page.params.id is missing", async () => {
		// Exercises the `page.params.id ?? ''` branch — header still renders, the
		// portal target is present, and nothing throws on the empty libraryId.
		pageState.params = {};
		const screen = renderLayout();

		await expect.element(screen.getByText('Family Photos')).toBeInTheDocument();
		expect(screen.container.querySelector('#library-header-actions')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="page"]')).not.toBeNull();
	});

	it('renders without name/emoji when data.library is absent', async () => {
		// Covers the `data.library?.name` / `data.library?.emoji` optional-chain
		// branches: the header row still renders, just without the name/emoji.
		const children = createRawSnippet(() => ({
			render: () => '<main data-testid="page">tab content</main>'
		}));
		const screen = render(Layout, {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			props: { data: {}, children } as any
		});

		expect(screen.container.textContent).not.toContain('Family Photos');
		expect(screen.container.querySelector('#library-header-actions')).not.toBeNull();
		expect(screen.container.querySelector('[data-testid="page"]')).not.toBeNull();
	});
});
