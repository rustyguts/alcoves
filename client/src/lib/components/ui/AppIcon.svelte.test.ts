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
});
