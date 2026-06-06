import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { FolderBreadcrumb } from '$lib/types/api';
import LibraryBreadcrumb from './LibraryBreadcrumb.svelte';

// Control the shared folder-ancestry store per test.
let folderPath: FolderBreadcrumb[] = [];
vi.mock('$lib/state/library-folder-path.svelte', () => ({
	libraryFolderPath: {
		get value() {
			return folderPath;
		}
	}
}));

describe('LibraryBreadcrumb', () => {
	beforeEach(() => {
		folderPath = [];
	});

	it('renders the library-name root crumb linking to the Files root', async () => {
		const screen = render(LibraryBreadcrumb, {
			props: { libraryId: 'lib-1', libraryName: 'Family Photos' }
		});
		const links = screen.container.querySelectorAll('a');
		// At the root there is a single crumb, rendered as the current page (not a link).
		expect(links.length).toBe(0);
		const current = screen.container.querySelector('[aria-current="page"]')!;
		expect(current.textContent?.trim()).toBe('Family Photos');
	});

	it('falls back to "Library" when no name is provided', async () => {
		const screen = render(LibraryBreadcrumb, { props: { libraryId: 'lib-1' } });
		const current = screen.container.querySelector('[aria-current="page"]')!;
		expect(current.textContent?.trim()).toBe('Library');
	});

	it('appends folder ancestry crumbs, linking ancestors and marking the last as current', async () => {
		folderPath = [
			{ id: 'f1', name: 'Trips' },
			{ id: 'f2', name: 'Japan 2025' }
		];
		const screen = render(LibraryBreadcrumb, {
			props: { libraryId: 'lib-1', libraryName: 'Family Photos' }
		});

		// Root + first folder are links; the last folder is the current (non-link) crumb.
		const links = Array.from(screen.container.querySelectorAll('a'));
		expect(links.map((a) => a.textContent?.trim())).toEqual(['Family Photos', 'Trips']);
		expect(links[0].getAttribute('href')).toBe('/libraries/lib-1');
		expect(links[1].getAttribute('href')).toBe('/libraries/lib-1?folder=f1');

		const current = screen.container.querySelector('[aria-current="page"]')!;
		expect(current.textContent?.trim()).toBe('Japan 2025');
	});

	it('url-encodes folder ids in crumb links', async () => {
		folderPath = [
			{ id: 'a b/c', name: 'Weird' },
			{ id: 'tail', name: 'Tail' }
		];
		const screen = render(LibraryBreadcrumb, { props: { libraryId: 'lib-9' } });
		const links = Array.from(screen.container.querySelectorAll('a'));
		// Root + the first (now non-current) folder crumb.
		expect(links[1].getAttribute('href')).toBe('/libraries/lib-9?folder=a%20b%2Fc');
	});

	it('renders a separator between every crumb', async () => {
		folderPath = [
			{ id: 'f1', name: 'Trips' },
			{ id: 'f2', name: 'Japan' }
		];
		const screen = render(LibraryBreadcrumb, { props: { libraryId: 'lib-1' } });
		// 3 crumbs -> 2 separators (the aria-hidden <li> wrappers).
		const separators = screen.container.querySelectorAll('li[aria-hidden="true"]');
		expect(separators.length).toBe(2);
	});
});
