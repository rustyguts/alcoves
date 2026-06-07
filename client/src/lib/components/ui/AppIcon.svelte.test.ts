import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AppIcon from './AppIcon.svelte';
import { ICONS } from '$lib/utils/icons';

describe('AppIcon', () => {
	it('renders an inline SVG for a known lineicons glyph (offline)', async () => {
		const screen = render(AppIcon, { props: { name: ICONS.close } });
		const svg = screen.container.querySelector('svg');
		expect(svg).not.toBeNull();
	});

	it('forwards the class attribute to the icon', async () => {
		const screen = render(AppIcon, {
			props: { name: ICONS.search, class: 'size-4 text-primary' }
		});
		const svg = screen.container.querySelector('svg');
		expect(svg?.getAttribute('class')).toContain('size-4');
	});

	it('applies the default size-4 when no sizing class is given', async () => {
		const screen = render(AppIcon, { props: { name: ICONS.search } });
		expect(screen.container.querySelector('svg')?.getAttribute('class')).toContain('size-4');
	});

	it('does not override an explicit size class', async () => {
		const screen = render(AppIcon, { props: { name: ICONS.search, class: 'size-6' } });
		const cls = screen.container.querySelector('svg')?.getAttribute('class') ?? '';
		expect(cls).toContain('size-6');
		expect(cls).not.toContain('size-4');
	});

	it('honors the size prop and can opt out with size="none"', async () => {
		const lg = render(AppIcon, { props: { name: ICONS.search, size: 'lg' } });
		expect(lg.container.querySelector('svg')?.getAttribute('class')).toContain('size-5');
		const none = render(AppIcon, { props: { name: ICONS.search, size: 'none' } });
		const cls = none.container.querySelector('svg')?.getAttribute('class') ?? '';
		expect(cls).not.toContain('size-4');
	});

	it('is aria-hidden by default (decorative)', async () => {
		const screen = render(AppIcon, { props: { name: ICONS.search } });
		expect(screen.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('lets callers override aria-hidden for a standalone labelled icon', async () => {
		const screen = render(AppIcon, {
			props: { name: ICONS.search, 'aria-hidden': false, 'aria-label': 'Search' }
		});
		const svg = screen.container.querySelector('svg');
		expect(svg?.getAttribute('aria-hidden')).not.toBe('true');
		expect(svg?.getAttribute('aria-label')).toBe('Search');
	});
});
