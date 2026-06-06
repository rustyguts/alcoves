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

function content(root: ParentNode) {
	return root.querySelector('[data-part="content"]');
}

describe('AppModal', () => {
	it('renders the body slot content when open', async () => {
		const screen = render(AppModal, {
			props: { open: true, children: bodySnippet('Modal content') }
		});
		await tick();
		expect(screen.container.textContent).toContain('Modal content');
		expect(content(screen.container)?.getAttribute('data-state')).toBe('open');
	});

	it('hides the modal content when closed', async () => {
		const screen = render(AppModal, {
			props: { open: false, children: bodySnippet('Hidden content') }
		});
		await tick();
		// Skeleton's dialog keeps content mounted but flags it hidden when closed.
		const box = content(screen.container);
		expect(box?.getAttribute('data-state')).toBe('closed');
		expect(box?.hasAttribute('hidden')).toBe(true);
	});

	it('renders the title and description when provided', async () => {
		const screen = render(AppModal, {
			props: { open: true, title: 'My Title', description: 'My description' }
		});
		await tick();
		expect(screen.container.textContent).toContain('My Title');
		expect(screen.container.textContent).toContain('My description');
	});

	it('omits the header when neither title nor description is given', async () => {
		const screen = render(AppModal, {
			props: { open: true, children: bodySnippet('Bare body') }
		});
		await tick();
		expect(screen.container.querySelector('header')).toBeNull();
		expect(screen.container.textContent).toContain('Bare body');
	});

	it('merges boxClass onto the modal content box', async () => {
		const screen = render(AppModal, {
			props: { open: true, boxClass: 'custom-box-class', children: bodySnippet('Boxed') }
		});
		await tick();
		expect(content(screen.container)?.classList.contains('custom-box-class')).toBe(true);
	});

	it('exposes an accessible close trigger that closes the dialog', async () => {
		const screen = render(AppModal, {
			props: { open: true, children: bodySnippet('Closable') }
		});
		await tick();
		expect(content(screen.container)?.getAttribute('data-state')).toBe('open');

		const closeBtn = screen.container.querySelector<HTMLButtonElement>('[aria-label="Close"]');
		expect(closeBtn).not.toBeNull();
		closeBtn!.click();

		// onOpenChange flips the bound `open` to false, so the dialog transitions to closed.
		await vi.waitFor(() => {
			expect(content(screen.container)?.getAttribute('data-state')).toBe('closed');
		});
	});
});
