import { describe, it, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import Card from './Card.svelte';

describe('Card', () => {
	it('renders the tonal bordered surface with md padding by default', () => {
		const screen = render(Card, {});
		const root = screen.container.querySelector('div.card');
		expect(root).not.toBeNull();
		expect(root?.className).toContain('preset-tonal-surface');
		expect(root?.className).toContain('border');
		expect(screen.container.querySelector('.p-4')).not.toBeNull();
	});

	it('supports filled and elevated tones', () => {
		const filled = render(Card, { props: { tone: 'filled' } });
		expect(filled.container.querySelector('.card')?.className).toContain(
			'preset-filled-surface-50-950'
		);
		const elevated = render(Card, { props: { tone: 'elevated' } });
		expect(elevated.container.querySelector('.card')?.className).toContain('shadow-xl');
	});

	it('maps the padding scale', () => {
		expect(
			render(Card, { props: { padding: 'none' } }).container.querySelector('.p-0')
		).not.toBeNull();
		expect(
			render(Card, { props: { padding: 'sm' } }).container.querySelector('.p-3')
		).not.toBeNull();
		expect(
			render(Card, { props: { padding: 'lg' } }).container.querySelector('.p-6')
		).not.toBeNull();
	});

	it('renders header and footer regions with dividers', () => {
		const header = createRawSnippet(() => ({ render: () => `<h3>Head</h3>` }));
		const footer = createRawSnippet(() => ({ render: () => `<span>Foot</span>` }));
		const screen = render(Card, { props: { header, footer } });
		expect(screen.container.querySelector('.border-b')).not.toBeNull();
		expect(screen.container.querySelector('.border-t')).not.toBeNull();
		expect(screen.container.textContent).toContain('Head');
		expect(screen.container.textContent).toContain('Foot');
	});
});
