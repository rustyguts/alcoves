import { describe, it, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import PageHeader from './PageHeader.svelte';

describe('PageHeader', () => {
	it('renders the title as an h1', () => {
		const screen = render(PageHeader, { props: { title: 'Admin Dashboard' } });
		const h1 = screen.container.querySelector('h1');
		expect(h1?.textContent?.trim()).toBe('Admin Dashboard');
		expect(h1?.className).toContain('text-2xl');
	});

	it('renders the description when provided and omits it otherwise', () => {
		const withDesc = render(PageHeader, {
			props: { title: 'Search', description: 'Find anything across your libraries.' }
		});
		expect(withDesc.container.textContent).toContain('Find anything across your libraries.');

		const without = render(PageHeader, { props: { title: 'Search' } });
		expect(without.container.querySelectorAll('p').length).toBe(0);
	});

	it('renders the actions snippet', () => {
		const actions = createRawSnippet(() => ({ render: () => `<button>New</button>` }));
		const screen = render(PageHeader, { props: { title: 'People', actions } });
		expect(screen.container.textContent).toContain('New');
	});
});
