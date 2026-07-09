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

// bits-ui's AlertDialog.Content is portalled to `document.body`.
function action() {
	return document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]');
}
function cancel() {
	return document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]');
}

describe('ConfirmModal', () => {
	it('renders the title and message when open', async () => {
		render(ConfirmModal, { props: { ...baseProps } });
		await tick();
		const content = document.querySelector('[data-slot="alert-dialog-content"]');
		expect(content?.textContent).toContain('Confirm Delete');
		expect(content?.textContent).toContain('Are you sure you want to delete this?');
	});

	it('renders the confirm button with a custom label', async () => {
		render(ConfirmModal, { props: { ...baseProps, confirmLabel: 'Remove' } });
		await tick();
		expect(action()?.textContent).toContain('Remove');
	});

	it('renders a cancel button', async () => {
		render(ConfirmModal, { props: { ...baseProps } });
		await tick();
		expect(cancel()?.textContent).toContain('Cancel');
	});

	it('fires onconfirm when the confirm button is clicked', async () => {
		const onconfirm = vi.fn();
		render(ConfirmModal, { props: { ...baseProps, onconfirm } });
		await tick();
		action()?.click();
		expect(onconfirm).toHaveBeenCalledTimes(1);
	});

	it('does not fire onconfirm when cancel is clicked, and fires oncancel', async () => {
		const onconfirm = vi.fn();
		const oncancel = vi.fn();
		render(ConfirmModal, { props: { ...baseProps, onconfirm, oncancel } });
		await tick();
		cancel()?.click();
		await tick();
		expect(onconfirm).not.toHaveBeenCalled();
		expect(oncancel).toHaveBeenCalledTimes(1);
	});

	it('disables the confirm button while pending', async () => {
		render(ConfirmModal, { props: { ...baseProps, pending: true } });
		await tick();
		expect(action()?.disabled).toBe(true);
	});

	it('visually dims and functionally blocks cancel while pending', async () => {
		// bits-ui's AlertDialog.Cancel consumes `disabled` to gate its internal
		// close handler but doesn't reflect it as a native `disabled` DOM
		// attribute — assert the functional block (no oncancel fires) and the
		// hand-applied visual treatment instead.
		const oncancel = vi.fn();
		render(ConfirmModal, { props: { ...baseProps, pending: true, oncancel } });
		await tick();
		expect(cancel()?.className).toContain('opacity-50');
		cancel()?.click();
		await tick();
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('shows a spinning loader icon instead of the confirm icon while pending', async () => {
		render(ConfirmModal, { props: { ...baseProps, pending: true } });
		await tick();
		expect(action()?.querySelector('.animate-spin')).not.toBeNull();
	});

	it('maps an error confirmClass onto the destructive Button variant', async () => {
		render(ConfirmModal, { props: { ...baseProps, confirmClass: 'btn-soft btn-error' } });
		await tick();
		expect(action()?.className).toContain('bg-destructive/10');
		expect(action()?.className).toContain('text-destructive');
	});

	it('defaults the confirm button to the primary/default Button variant', async () => {
		render(ConfirmModal, { props: { ...baseProps } });
		await tick();
		expect(action()?.className).toContain('bg-primary');
	});

	it('falls back non-error confirmClass hints (e.g. legacy warning) to the default variant', async () => {
		render(ConfirmModal, { props: { ...baseProps, confirmClass: 'btn-soft btn-warning' } });
		await tick();
		expect(action()?.className).toContain('bg-primary');
		expect(action()?.className).not.toContain('bg-destructive/10');
	});
});
