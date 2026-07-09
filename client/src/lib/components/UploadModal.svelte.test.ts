import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import UploadModal from './UploadModal.svelte';

// Mock the global upload-queue singleton — the component only calls `addFiles`.
const addFiles = vi.fn();
vi.mock('$lib/state/upload-queue.svelte', () => ({
	uploadQueue: {
		addFiles: (...args: unknown[]) => addFiles(...args)
	}
}));

beforeEach(() => {
	addFiles.mockReset();
});

const baseProps = {
	libraryId: 'lib-123',
	libraryName: 'My Library',
	parentFolderId: 'folder-9',
	open: true
};

// bits-ui's Dialog.Content (via AppModal) is portalled to `document.body`, not
// the mounted container — query the document for it, per the AppModal idiom.
function dialogContent(): HTMLElement {
	const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
	expect(content, 'dialog content').toBeTruthy();
	return content!;
}

function fileInput(root: ParentNode): HTMLInputElement {
	const input = root.querySelector<HTMLInputElement>('input[type="file"]');
	expect(input, 'file input').toBeTruthy();
	return input!;
}

function uploadButton(root: ParentNode): HTMLButtonElement {
	const btn = Array.from(root.querySelectorAll('button')).find((b) =>
		b.textContent?.includes('Upload')
	) as HTMLButtonElement | undefined;
	expect(btn, 'Upload button').toBeTruthy();
	return btn!;
}

function cancelButton(root: ParentNode): HTMLButtonElement {
	const btn = Array.from(root.querySelectorAll('button')).find(
		(b) => b.textContent?.trim() === 'Cancel'
	) as HTMLButtonElement | undefined;
	expect(btn, 'Cancel button').toBeTruthy();
	return btn!;
}

/** Set real File objects on a native file input via DataTransfer (browser env). */
async function selectFiles(input: HTMLInputElement, files: File[]) {
	const dt = new DataTransfer();
	for (const f of files) dt.items.add(f);
	input.files = dt.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
}

describe('UploadModal', () => {
	it('renders the destination library and starts with upload disabled', async () => {
		render(UploadModal, { props: baseProps });
		await tick();

		const content = dialogContent();
		expect(content.textContent).toContain('Upload Files');
		expect(content.textContent).toContain('Uploading to');
		expect(content.textContent).toContain('My Library');
		expect(uploadButton(content).disabled).toBe(true);
	});

	it('shows selected file count with pluralization', async () => {
		render(UploadModal, { props: baseProps });
		await tick();
		const content = dialogContent();

		await selectFiles(fileInput(content), [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
		expect(content.textContent).toContain('2 files selected');

		await selectFiles(fileInput(content), [new File(['c'], 'c.txt')]);
		expect(content.textContent).toContain('1 file selected');
		expect(content.textContent).not.toContain('1 files selected');
	});

	it('enables upload after selecting files', async () => {
		render(UploadModal, { props: baseProps });
		await tick();
		const content = dialogContent();

		expect(uploadButton(content).disabled).toBe(true);
		await selectFiles(fileInput(content), [new File(['hi'], 'hi.txt')]);
		expect(uploadButton(content).disabled).toBe(false);
	});

	it('queues selected files with library + folder context and closes on upload', async () => {
		let open = true;
		render(UploadModal, {
			props: {
				...baseProps,
				get open() {
					return open;
				},
				set open(v: boolean) {
					open = v;
				}
			}
		});
		await tick();
		const content = dialogContent();

		const files = [new File(['hello'], 'hello.txt')];
		await selectFiles(fileInput(content), files);

		uploadButton(content).click();
		await tick();

		expect(addFiles).toHaveBeenCalledWith(
			expect.arrayContaining([expect.any(File)]),
			'lib-123',
			'My Library',
			'folder-9'
		);
		expect(open).toBe(false);
	});

	it('does not queue anything when no files are selected', async () => {
		render(UploadModal, { props: baseProps });
		await tick();
		const content = dialogContent();

		// Disabled, but force the handler anyway to prove the guard.
		const btn = uploadButton(content);
		btn.disabled = false;
		btn.click();
		await tick();

		expect(addFiles).not.toHaveBeenCalled();
	});

	it('closes without queuing when Cancel is clicked', async () => {
		let open = true;
		render(UploadModal, {
			props: {
				...baseProps,
				get open() {
					return open;
				},
				set open(v: boolean) {
					open = v;
				}
			}
		});
		await tick();
		const content = dialogContent();

		cancelButton(content).click();
		await tick();

		expect(open).toBe(false);
		expect(addFiles).not.toHaveBeenCalled();
	});

	it('clears the selection when the modal closes', async () => {
		const screen = render(UploadModal, { props: { ...baseProps, open: true } });
		await tick();
		let content = dialogContent();

		await selectFiles(fileInput(content), [new File(['x'], 'x.txt')]);
		expect(content.textContent).toContain('1 file selected');

		// Close (prop-driven, mirroring the parent flipping its `uploadOpen`
		// store flag to false).
		await screen.rerender({ ...baseProps, open: false });
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});

		// Reopen — the selection must have actually been cleared by the
		// component's own `$effect(() => { if (!open) selectedFiles = []; })`
		// while closed, not merely hidden by the dialog unmounting. A stale
		// selection here would leave "1 file selected" visible and Upload
		// enabled on reopen, even though the user never re-picked anything.
		await screen.rerender({ ...baseProps, open: true });
		await tick();
		content = dialogContent();
		expect(content.textContent).not.toContain('file selected');
		expect(uploadButton(content).disabled).toBe(true);
	});
});
