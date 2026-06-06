import { describe, it, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import Button from './Button.svelte';

const label = createRawSnippet(() => ({ render: () => `<span>Save</span>` }));

describe('Button', () => {
	it('renders a native <button> with the default filled-primary preset', () => {
		const screen = render(Button, { props: { children: label } });
		const btn = screen.container.querySelector('button');
		expect(btn).not.toBeNull();
		expect(btn?.className).toContain('btn');
		expect(btn?.className).toContain('preset-filled-primary-500');
		expect(btn?.getAttribute('type')).toBe('button');
		expect(btn?.textContent).toContain('Save');
	});

	it('maps variant/color to the exact Skeleton preset tokens', () => {
		const tonal = render(Button, { props: { variant: 'tonal', color: 'surface' } });
		expect(tonal.container.querySelector('button')?.className).toContain('preset-tonal-surface');

		const outlined = render(Button, { props: { variant: 'outlined', color: 'error' } });
		expect(outlined.container.querySelector('button')?.className).toContain(
			'preset-outlined-error-500'
		);

		const ghost = render(Button, { props: { variant: 'ghost' } });
		const ghostCls = ghost.container.querySelector('button')?.className ?? '';
		expect(ghostCls).toContain('hover:preset-tonal');
		expect(ghostCls).not.toContain('preset-filled');
	});

	it('adds size tokens for sm/lg and the btn-icon family for iconOnly', () => {
		expect(
			render(Button, { props: { size: 'sm' } }).container.querySelector('button')?.className
		).toContain('btn-sm');
		const icon = render(Button, { props: { iconOnly: true, size: 'lg' } });
		const cls = icon.container.querySelector('button')?.className ?? '';
		expect(cls).toContain('btn-icon');
		expect(cls).toContain('btn-icon-lg');
		expect(cls).not.toContain('btn-lg ');
	});

	it('renders an <a> when href is set and forwards extra classes', () => {
		const screen = render(Button, {
			props: { href: '/x', variant: 'outlined', color: 'surface', class: 'gap-2' }
		});
		const a = screen.container.querySelector('a');
		expect(a?.getAttribute('href')).toBe('/x');
		expect(a?.className).toContain('preset-outlined-surface-500');
		expect(a?.className).toContain('gap-2');
		expect(screen.container.querySelector('button')).toBeNull();
	});

	it('disables and shows a spinner while loading', () => {
		const screen = render(Button, { props: { loading: true, children: label } });
		const btn = screen.container.querySelector('button');
		expect(btn?.hasAttribute('disabled')).toBe(true);
		expect(btn?.getAttribute('aria-busy')).toBe('true');
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('respects an explicit disabled and renders the leading icon snippet', () => {
		const leading = createRawSnippet(() => ({ render: () => `<i data-testid="lead"></i>` }));
		const screen = render(Button, { props: { disabled: true, icon: leading } });
		expect(screen.container.querySelector('button')?.hasAttribute('disabled')).toBe(true);
		expect(screen.container.querySelector('[data-testid="lead"]')).not.toBeNull();
	});

	it('stretches full width', () => {
		const screen = render(Button, { props: { fullWidth: true } });
		expect(screen.container.querySelector('button')?.className).toContain('w-full');
	});
});
