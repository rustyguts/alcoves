import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import type { FolderBreadcrumb } from '$lib/types/api';
import LibraryHeader from './LibraryHeader.svelte';

// LibraryHeader composes the real LibraryBreadcrumb, which reads the shared
// folder-ancestry store. Keep it at the library root so the breadcrumb renders
// just the library-name crumb — here we test LibraryHeader's composition
// (emoji prefix + breadcrumb + snippets), not the breadcrumb internals.
let folderPath: FolderBreadcrumb[] = [];
vi.mock('$lib/state/library-folder-path.svelte', () => ({
	libraryFolderPath: {
		get value() {
			return folderPath;
		}
	}
}));

/** Helper: a snippet that renders a single element with the given text + tag. */
function textSnippet(text: string, tag = 'div') {
	return createRawSnippet(() => ({
		render: () => `<${tag}>${text}</${tag}>`
	}));
}

describe('LibraryHeader', () => {
	beforeEach(() => {
		folderPath = [];
	});

	it('renders the library name via the breadcrumb', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'My Library' }
		});
		const current = screen.container.querySelector('[aria-current="page"]')!;
		expect(current.textContent?.trim()).toBe('My Library');
	});

	it('passes the library id through so the breadcrumb root links to its Files root', async () => {
		folderPath = [{ id: 'f1', name: 'Trips' }];
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-9', name: 'Photos' }
		});
		// Root crumb is a link (a child folder is current); it must point at lib-9.
		const root = screen.container.querySelector('a')!;
		expect(root.getAttribute('href')).toBe('/libraries/lib-9');
		expect(root.textContent?.trim()).toBe('Photos');
	});

	it('renders the emoji as a display-only prefix when present', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib', emoji: '\u{1F680}' }
		});
		expect(screen.container.textContent).toContain('\u{1F680}');
	});

	it('does not render an emoji when absent', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib' }
		});
		expect(screen.container.textContent).not.toContain('\u{1F680}');
	});

	it('is not editable: no rename input or heading affordance', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib' }
		});
		expect(screen.container.querySelector('input')).toBeNull();
		expect(screen.container.querySelector('h1')).toBeNull();
	});

	it('renders the default children snippet (tabs)', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib', children: textSnippet('TABS') }
		});
		await expect.element(screen.getByText('TABS')).toBeInTheDocument();
	});

	it('renders the actions snippet', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib', actions: textSnippet('Action', 'button') }
		});
		const action = screen.container.querySelector('button')!;
		expect(action.textContent).toBe('Action');
	});

	it('drops the heading row in hideHeading mode but keeps the tabs', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib', hideHeading: true, children: textSnippet('TABS') }
		});
		// No breadcrumb heading rendered.
		expect(screen.container.querySelector('[aria-current="page"]')).toBeNull();
		expect(screen.container.querySelector('nav')).toBeNull();
		// Tabs still render, with no top margin (the row reclaims the space).
		await expect.element(screen.getByText('TABS')).toBeInTheDocument();
		const tabsWrapper = screen.getByText('TABS').element().parentElement!;
		expect(tabsWrapper.className).not.toContain('mt-3');
	});

	it('spaces the tabs below the heading with mt-3 when the heading shows', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib', children: textSnippet('TABS') }
		});
		const tabsWrapper = screen.getByText('TABS').element().parentElement!;
		expect(tabsWrapper.className).toContain('mt-3');
	});

	it('omits the actions container entirely when no actions snippet is given', async () => {
		const screen = render(LibraryHeader, {
			props: { libraryId: 'lib-1', name: 'Lib' }
		});
		// The only flex containers are the heading row and the inner name group.
		const headingRow = screen.container.querySelector('.justify-between')!;
		expect(headingRow.children.length).toBe(1);
	});
});
