import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import AppPanelRow from './AppPanelRow.svelte';

/** Helper: a snippet that renders a single element with the given text + tag. */
function textSnippet(text: string, tag = 'span') {
	return createRawSnippet(() => ({
		render: () => `<${tag}>${text}</${tag}>`
	}));
}

describe('AppPanelRow', () => {
	it('renders the title and description text', async () => {
		const screen = render(AppPanelRow, {
			props: { title: 'Enable facial recognition', description: 'Group detected faces.' }
		});
		await expect.element(screen.getByText('Enable facial recognition')).toBeInTheDocument();
		await expect.element(screen.getByText('Group detected faces.')).toBeInTheDocument();
	});

	it('omits the description paragraph when none is given', async () => {
		const screen = render(AppPanelRow, { props: { title: 'Just a title' } });
		const paragraphs = screen.container.querySelectorAll('p');
		expect(paragraphs.length).toBe(1);
		expect(paragraphs[0]?.textContent).toBe('Just a title');
	});

	it('renders the control (children snippet) on the right', async () => {
		const screen = render(AppPanelRow, {
			props: { title: 'Toggle', children: textSnippet('the-control', 'button') }
		});
		const control = screen.container.querySelector('button');
		expect(control?.textContent).toBe('the-control');
		// The control lives inside the shrink-0 right column.
		expect(control?.closest('.shrink-0')).not.toBeNull();
	});

	it('renders the descriptionExtra snippet beneath the text', async () => {
		const screen = render(AppPanelRow, {
			props: { title: 'Extra', descriptionExtra: textSnippet('extra-desc') }
		});
		await expect.element(screen.getByText('extra-desc')).toBeInTheDocument();
	});

	it('colors the title with the error token in danger mode', async () => {
		const screen = render(AppPanelRow, { props: { title: 'Delete library', danger: true } });
		const title = screen.container.querySelector('p');
		expect(title?.className).toContain('text-error-500');
		expect(title?.className).not.toContain('text-surface-950-50');
	});

	it('uses the highlighted title token by default', async () => {
		const screen = render(AppPanelRow, { props: { title: 'Normal' } });
		const title = screen.container.querySelector('p');
		expect(title?.className).toContain('text-surface-950-50');
		expect(title?.className).not.toContain('text-error-500');
	});

	it('center-aligns the control by default and top-aligns with align="start"', async () => {
		const centered = render(AppPanelRow, { props: { title: 'A' } });
		const centeredRow = centered.container.firstElementChild;
		expect(centeredRow?.className).toContain('sm:items-center');
		expect(centeredRow?.className).not.toContain('sm:items-start');

		const started = render(AppPanelRow, { props: { title: 'B', align: 'start' } });
		const startedRow = started.container.firstElementChild;
		expect(startedRow?.className).toContain('sm:items-start');
		expect(startedRow?.className).not.toContain('sm:items-center');
	});
});
