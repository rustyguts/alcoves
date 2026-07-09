import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StatCard from './StatCard.svelte';
import { ICONS } from '$lib/utils/icons';

describe('StatCard', () => {
	it('renders the title, value, and icon on the canonical card surface', () => {
		const screen = render(StatCard, {
			props: { title: 'Files', value: '1,234', icon: ICONS.files }
		});
		const root = screen.container.querySelector('[data-slot="stat-card"]');
		expect(root).not.toBeNull();
		expect(root?.className).toContain('bg-card');
		expect(root?.className).toContain('border');
		expect(screen.container.textContent).toContain('Files');
		expect(screen.container.textContent).toContain('1,234');
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('renders a numeric value', () => {
		const screen = render(StatCard, { props: { title: 'Active', value: 7, icon: ICONS.files } });
		expect(screen.container.textContent).toContain('7');
	});

	it('renders the optional caption when provided and omits it otherwise', () => {
		const withCaption = render(StatCard, {
			props: { title: 'Storage', value: '5 GB', icon: ICONS.storage, caption: 'Total disk usage' }
		});
		expect(withCaption.container.textContent).toContain('Total disk usage');

		const without = render(StatCard, {
			props: { title: 'Storage', value: '5 GB', icon: ICONS.storage }
		});
		// Only the title + value paragraphs render (no caption paragraph).
		expect(without.container.querySelectorAll('p').length).toBe(2);
	});

	it('applies the icon-badge tint to the badge', () => {
		const screen = render(StatCard, {
			props: {
				title: 'Failed',
				value: 3,
				icon: ICONS.files,
				iconClass: 'text-destructive bg-destructive/10'
			}
		});
		const badge = screen.container.querySelector('[data-slot="stat-card-icon"]');
		expect(badge?.className).toContain('text-destructive');
		expect(badge?.className).toContain('bg-destructive/10');
	});

	it('defaults the icon-badge tint to primary', () => {
		const screen = render(StatCard, {
			props: { title: 'Files', value: 1, icon: ICONS.files }
		});
		const badge = screen.container.querySelector('[data-slot="stat-card-icon"]');
		expect(badge?.className).toContain('text-primary');
	});
});
