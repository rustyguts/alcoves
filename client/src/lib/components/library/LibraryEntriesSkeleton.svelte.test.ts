import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LibraryEntriesSkeleton from './LibraryEntriesSkeleton.svelte';

describe('LibraryEntriesSkeleton', () => {
	it('renders the table skeleton with 8 rows in file mode', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'file', showTrashed: false }
		});
		expect(screen.container.querySelector('table')).not.toBeNull();
		expect(screen.container.querySelectorAll('tbody tr')).toHaveLength(8);
	});

	it('renders the card grid with 8 cards in card mode', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'card', showTrashed: false }
		});
		expect(screen.container.querySelector('table')).toBeNull();
		const grid = screen.container.querySelector('.grid');
		expect(grid).not.toBeNull();
		expect(grid!.querySelectorAll(':scope > div')).toHaveLength(8);
	});

	it('shows the Modified header when not viewing trash', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'file', showTrashed: false }
		});
		expect(screen.container.textContent).toContain('Modified');
		expect(screen.container.textContent).not.toContain('Trashed');
	});

	it('shows the Trashed header when viewing trash', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'file', showTrashed: true }
		});
		expect(screen.container.textContent).toContain('Trashed');
		expect(screen.container.textContent).not.toContain('Modified');
	});

	it('renders the static table headers', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'file', showTrashed: false }
		});
		const text = screen.container.textContent ?? '';
		expect(text).toContain('Name');
		expect(text).toContain('Tags');
		expect(text).toContain('Owner');
		expect(text).toContain('Size');
	});

	it('renders skeleton placeholder elements inside the table rows', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'file', showTrashed: false }
		});
		expect(
			screen.container.querySelectorAll('tbody [data-slot="skeleton"]').length
		).toBeGreaterThan(0);
	});

	it('renders skeleton placeholder elements inside the card grid', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'card', showTrashed: false }
		});
		expect(
			screen.container.querySelectorAll('.grid [data-slot="skeleton"]').length
		).toBeGreaterThan(0);
	});

	it('applies the deterministic width style to the name placeholder rows', async () => {
		const screen = render(LibraryEntriesSkeleton, {
			props: { entryViewMode: 'file', showTrashed: false }
		});
		// First row (i=1): 40 + ((1 * 17) % 40) = 57%.
		const first = screen.container.querySelector(
			'tbody tr:first-child td:nth-child(2) [data-slot="skeleton"]'
		) as HTMLElement | null;
		expect(first).not.toBeNull();
		expect(first!.style.width).toBe('57%');
	});
});
