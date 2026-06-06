import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import ConfirmModal from './ConfirmModal.svelte';

const baseProps = {
	open: true,
	title: 'Confirm Delete',
	message: 'Are you sure you want to delete this?',
	confirmLabel: 'Delete'
};

function findButton(root: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as
		| HTMLButtonElement
		| undefined;
}

describe('ConfirmModal', () => {
	it('renders the title and message when open', async () => {
		const screen = render(ConfirmModal, { props: { ...baseProps } });
		await tick();
		expect(screen.container.textContent).toContain('Confirm Delete');
		expect(screen.container.textContent).toContain('Are you sure you want to delete this?');
	});

	it('renders the confirm button with a custom label', async () => {
		const screen = render(ConfirmModal, { props: { ...baseProps, confirmLabel: 'Remove' } });
		await tick();
		expect(findButton(screen.container, 'Remove')).toBeDefined();
	});

	it('renders a cancel button', async () => {
		const screen = render(ConfirmModal, { props: { ...baseProps } });
		await tick();
		expect(findButton(screen.container, 'Cancel')).toBeDefined();
	});

	it('fires onconfirm when the confirm button is clicked', async () => {
		const onconfirm = vi.fn();
		const screen = render(ConfirmModal, { props: { ...baseProps, onconfirm } });
		await tick();
		findButton(screen.container, 'Delete')?.click();
		expect(onconfirm).toHaveBeenCalledTimes(1);
	});

	it('does not fire onconfirm when cancel is clicked', async () => {
		const onconfirm = vi.fn();
		const screen = render(ConfirmModal, { props: { ...baseProps, onconfirm } });
		await tick();
		findButton(screen.container, 'Cancel')?.click();
		expect(onconfirm).not.toHaveBeenCalled();
	});

	it('disables both buttons while pending', async () => {
		const screen = render(ConfirmModal, { props: { ...baseProps, pending: true } });
		await tick();
		expect(findButton(screen.container, 'Delete')?.disabled).toBe(true);
		expect(findButton(screen.container, 'Cancel')?.disabled).toBe(true);
	});

	it('shows a spinning loader icon instead of the confirm icon while pending', async () => {
		const screen = render(ConfirmModal, { props: { ...baseProps, pending: true } });
		await tick();
		expect(findButton(screen.container, 'Delete')?.querySelector('.animate-spin')).not.toBeNull();
	});

	it('maps an error confirmClass onto the error preset color', async () => {
		const screen = render(ConfirmModal, { props: { ...baseProps, confirmClass: 'bg-error-500' } });
		await tick();
		expect(findButton(screen.container, 'Delete')?.className).toContain('preset-filled-error-500');
	});

	it('maps a warning confirmClass onto the warning preset color', async () => {
		const screen = render(ConfirmModal, {
			props: { ...baseProps, confirmClass: 'text-warning-700' }
		});
		await tick();
		expect(findButton(screen.container, 'Delete')?.className).toContain(
			'preset-filled-warning-500'
		);
	});

	it('defaults the confirm button to the primary preset color', async () => {
		const screen = render(ConfirmModal, { props: { ...baseProps } });
		await tick();
		expect(findButton(screen.container, 'Delete')?.className).toContain(
			'preset-filled-primary-500'
		);
	});
});
