import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import SettingsSection from './SettingsSection.svelte';
import { ICONS } from '$lib/utils/icons';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('SettingsSection', () => {
	it('renders title, description and icon in the header', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'Sharing', description: 'Control link access', icon: ICONS.search }
		});
		const heading = screen.container.querySelector('h2');
		expect(heading?.textContent).toBe('Sharing');
		expect(screen.container.querySelector('p')?.textContent).toBe('Control link access');
		// The icon renders as an inline SVG via AppIcon.
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('renders body children below the header with a top margin', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'Box', children: text('section body') }
		});
		await expect.element(screen.getByText('section body')).toBeInTheDocument();
		const body = screen.container.querySelector('section > div:last-child');
		expect(body?.className).toContain('mt-4');
	});

	it('omits the top margin on the body when there is no header', async () => {
		const screen = render(SettingsSection, { props: { children: text('just a body') } });
		expect(screen.container.querySelector('h2')).toBeNull();
		await expect.element(screen.getByText('just a body')).toBeInTheDocument();
		const body = screen.container.querySelector('section > div:last-child');
		expect(body?.className).not.toContain('mt-4');
	});

	it('omits the header entirely when nothing header-related is provided', async () => {
		const screen = render(SettingsSection, { props: { children: text('body only') } });
		expect(screen.container.querySelector('h2')).toBeNull();
		// Only the body wrapper should exist under the section.
		const section = screen.container.querySelector('section')!;
		expect(section.children.length).toBe(1);
	});

	it('renders nothing in the section when neither header nor children are provided', async () => {
		const screen = render(SettingsSection, { props: {} });
		const section = screen.container.querySelector('section')!;
		expect(section.children.length).toBe(0);
	});

	it('renders the title snippet instead of the default icon/title row', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'ignored', icon: ICONS.search, title_: text('custom title') }
		});
		// Default <h2> is replaced by the snippet content.
		expect(screen.container.querySelector('h2')).toBeNull();
		await expect.element(screen.getByText('custom title')).toBeInTheDocument();
	});

	it('renders the actions snippet pinned in the header', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'With actions', actions: text('do thing') }
		});
		await expect.element(screen.getByText('do thing')).toBeInTheDocument();
		// Header exists because actions is present.
		expect(screen.container.querySelector('h2')?.textContent).toBe('With actions');
	});
});
