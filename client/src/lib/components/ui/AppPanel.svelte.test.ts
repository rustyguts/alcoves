import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import AppPanel from './AppPanel.svelte';
import { ICONS } from '$lib/utils/icons';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('AppPanel', () => {
	it('renders title, description and icon in the header', async () => {
		const screen = render(AppPanel, {
			props: { title: 'Settings', description: 'Tweak things', icon: ICONS.search }
		});
		const heading = screen.container.querySelector('h2');
		expect(heading?.textContent).toBe('Settings');
		expect(screen.container.querySelector('p')?.textContent).toBe('Tweak things');
		// The icon renders as an inline SVG via AppIcon.
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('renders body children inside a padded body by default', async () => {
		const screen = render(AppPanel, {
			props: { title: 'Box', children: text('hello body') }
		});
		await expect.element(screen.getByText('hello body')).toBeInTheDocument();
		const body = screen.container.querySelector('.card > div:last-child');
		expect(body?.className).toContain('p-4');
	});

	it('omits the header entirely when nothing header-related is provided', async () => {
		const screen = render(AppPanel, { props: { children: text('just a body') } });
		expect(screen.container.querySelector('h2')).toBeNull();
		// Only the body div should exist under the card.
		const card = screen.container.querySelector('.card')!;
		expect(card.children.length).toBe(1);
	});

	it('applies flush (p-0) when requested', async () => {
		const screen = render(AppPanel, {
			props: { title: 'Flush', flush: true, children: text('x') }
		});
		const body = screen.container.querySelector('.card > div:last-child');
		expect(body?.className).toContain('p-0');
		expect(body?.className).not.toContain('p-4');
	});

	it('lets bodyClass override flush', async () => {
		const screen = render(AppPanel, {
			props: { title: 'Custom', flush: true, bodyClass: 'px-6 py-8', children: text('x') }
		});
		const body = screen.container.querySelector('.card > div:last-child');
		expect(body?.className).toContain('px-6');
		expect(body?.className).toContain('py-8');
		expect(body?.className).not.toContain('p-0');
	});

	it('renders the title snippet instead of the default icon/title row', async () => {
		const screen = render(AppPanel, {
			props: { title: 'ignored', icon: ICONS.search, title_: text('custom title') }
		});
		// Default <h2> is replaced by the snippet content.
		expect(screen.container.querySelector('h2')).toBeNull();
		await expect.element(screen.getByText('custom title')).toBeInTheDocument();
	});

	it('renders the actions snippet pinned in the header', async () => {
		const screen = render(AppPanel, {
			props: { title: 'With actions', actions: text('do thing') }
		});
		await expect.element(screen.getByText('do thing')).toBeInTheDocument();
		// Header exists because actions is present.
		expect(screen.container.querySelector('h2')?.textContent).toBe('With actions');
	});
});
