import { describe, it, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import EmptyState from './EmptyState.svelte';
import { ICONS } from '$lib/utils/icons';

describe('EmptyState', () => {
	it('renders the icon, title, and description', () => {
		const screen = render(EmptyState, {
			props: { icon: ICONS.search, title: 'No results', description: 'Try another query.' }
		});
		expect(screen.container.querySelector('svg')).not.toBeNull();
		expect(screen.container.textContent).toContain('No results');
		expect(screen.container.textContent).toContain('Try another query.');
	});

	it('omits the description and actions when not provided', () => {
		const screen = render(EmptyState, { props: { icon: ICONS.search, title: 'Empty' } });
		// Only the title paragraph renders.
		expect(screen.container.querySelectorAll('p').length).toBe(1);
	});

	it('uses a neutral badge by default and an error badge for tone="error"', () => {
		const neutral = render(EmptyState, { props: { icon: ICONS.search, title: 'Empty' } });
		expect(neutral.container.querySelector('.rounded-full')?.className).toContain(
			'text-surface-500'
		);

		const error = render(EmptyState, {
			props: { icon: ICONS.warning, title: 'Failed', tone: 'error' }
		});
		expect(error.container.querySelector('.rounded-full')?.className).toContain('text-error-500');
	});

	it('renders the actions snippet', () => {
		const actions = createRawSnippet(() => ({ render: () => `<button>Retry</button>` }));
		const screen = render(EmptyState, {
			props: { icon: ICONS.warning, title: 'Failed', actions }
		});
		expect(screen.container.textContent).toContain('Retry');
	});
});
