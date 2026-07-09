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
		const heading = screen.container.querySelector('[data-slot="card-title"]');
		expect(heading?.textContent?.trim()).toBe('Sharing');
		expect(heading?.getAttribute('role')).toBe('heading');
		expect(heading?.getAttribute('aria-level')).toBe('2');
		expect(screen.container.querySelector('[data-slot="card-description"]')?.textContent).toBe(
			'Control link access'
		);
		// The icon renders as an inline SVG via AppIcon.
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('renders body children inside Card.Content', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'Box', children: text('section body') }
		});
		await expect.element(screen.getByText('section body')).toBeInTheDocument();
		expect(screen.container.querySelector('[data-slot="card-content"]')).not.toBeNull();
	});

	it('omits Card.Header when there is no title/description/icon/actions', async () => {
		const screen = render(SettingsSection, { props: { children: text('just a body') } });
		expect(screen.container.querySelector('[data-slot="card-header"]')).toBeNull();
		await expect.element(screen.getByText('just a body')).toBeInTheDocument();
	});

	it('omits Card.Content entirely when there are no children', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'Header only' }
		});
		expect(screen.container.querySelector('[data-slot="card-content"]')).toBeNull();
	});

	it('renders nothing but the bare Card when neither header nor children are provided', async () => {
		const screen = render(SettingsSection, { props: {} });
		const card = screen.container.querySelector('[data-slot="card"]')!;
		expect(card.children.length).toBe(0);
	});

	it('renders the title snippet instead of the default icon/title row', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'ignored', icon: ICONS.search, title_: text('custom title') }
		});
		// The default Card.Title is replaced by the snippet content.
		expect(screen.container.querySelector('[data-slot="card-title"]')).toBeNull();
		await expect.element(screen.getByText('custom title')).toBeInTheDocument();
	});

	it('renders the actions snippet pinned in the header', async () => {
		const screen = render(SettingsSection, {
			props: { title: 'With actions', actions: text('do thing') }
		});
		await expect.element(screen.getByText('do thing')).toBeInTheDocument();
		// Header exists because actions is present.
		expect(screen.container.querySelector('[data-slot="card-action"]')).not.toBeNull();
		expect(screen.container.querySelector('[data-slot="card-title"]')?.textContent?.trim()).toBe(
			'With actions'
		);
	});
});
