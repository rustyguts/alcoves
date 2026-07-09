import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick, createRawSnippet } from 'svelte';
import AppModal from './AppModal.svelte';

// A default-slot snippet that renders the given text as the modal body.
function bodySnippet(text: string) {
	return createRawSnippet(() => ({
		render: () => `<p data-testid="body">${text}</p>`
	}));
}

// bits-ui's Dialog.Content is portalled to `document.body`, not the mounted
// container, so assertions query the document rather than screen.container.
function content() {
	return document.querySelector('[data-slot="dialog-content"]');
}

describe('AppModal', () => {
	it('renders the body slot content when open', async () => {
		render(AppModal, {
			props: { open: true, children: bodySnippet('Modal content') }
		});
		await tick();
		expect(content()?.textContent).toContain('Modal content');
	});

	it('does not render the modal content when closed', async () => {
		render(AppModal, {
			props: { open: false, children: bodySnippet('Hidden content') }
		});
		await tick();
		// bits-ui's Dialog unmounts Content entirely (portalled) when closed.
		expect(content()).toBeNull();
	});

	it('renders the title and description when provided', async () => {
		render(AppModal, {
			props: { open: true, title: 'My Title', description: 'My description' }
		});
		await tick();
		expect(content()?.textContent).toContain('My Title');
		expect(content()?.textContent).toContain('My description');
	});

	it('renders a screen-reader-only title for accessibility when none is given', async () => {
		render(AppModal, {
			props: { open: true, children: bodySnippet('Bare body') }
		});
		await tick();
		const dialogTitle = document.querySelector('[data-slot="dialog-title"]');
		expect(dialogTitle).not.toBeNull();
		expect(dialogTitle?.closest('[data-slot="dialog-header"]')?.className).toContain('sr-only');
		expect(content()?.textContent).toContain('Bare body');
	});

	it('merges boxClass onto the modal content box', async () => {
		render(AppModal, {
			props: { open: true, boxClass: 'custom-box-class', children: bodySnippet('Boxed') }
		});
		await tick();
		expect(content()?.classList.contains('custom-box-class')).toBe(true);
	});

	it('exposes an accessible close trigger that closes the dialog', async () => {
		render(AppModal, {
			props: { open: true, children: bodySnippet('Closable') }
		});
		await tick();
		expect(content()).not.toBeNull();

		const closeBtn = document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
		expect(closeBtn).not.toBeNull();
		expect(closeBtn?.textContent?.trim()).toBe('Close');
		closeBtn!.click();

		// The internal close trigger flips the bound `open` to false.
		await vi.waitFor(() => {
			expect(content()).toBeNull();
		});
	});
});
