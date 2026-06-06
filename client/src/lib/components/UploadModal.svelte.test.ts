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
		const screen = render(UploadModal, { props: baseProps });
		await tick();

		expect(screen.container.textContent).toContain('Upload Files');
		expect(screen.container.textContent).toContain('Uploading to');
		expect(screen.container.textContent).toContain('My Library');
		expect(uploadButton(screen.container).disabled).toBe(true);
	});

	it('shows selected file count with pluralization', async () => {
		const screen = render(UploadModal, { props: baseProps });
		await tick();

		await selectFiles(fileInput(screen.container), [
			new File(['a'], 'a.txt'),
			new File(['b'], 'b.txt')
		]);
		expect(screen.container.textContent).toContain('2 files selected');

		await selectFiles(fileInput(screen.container), [new File(['c'], 'c.txt')]);
		expect(screen.container.textContent).toContain('1 file selected');
		expect(screen.container.textContent).not.toContain('1 files selected');
	});

	it('enables upload after selecting files', async () => {
		const screen = render(UploadModal, { props: baseProps });
		await tick();

		expect(uploadButton(screen.container).disabled).toBe(true);
		await selectFiles(fileInput(screen.container), [new File(['hi'], 'hi.txt')]);
		expect(uploadButton(screen.container).disabled).toBe(false);
	});

	it('queues selected files with library + folder context and closes on upload', async () => {
		let open = true;
		const screen = render(UploadModal, {
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

		const files = [new File(['hello'], 'hello.txt')];
		await selectFiles(fileInput(screen.container), files);

		uploadButton(screen.container).click();
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
		const screen = render(UploadModal, { props: baseProps });
		await tick();

		// Disabled, but force the handler anyway to prove the guard.
		const btn = uploadButton(screen.container);
		btn.disabled = false;
		btn.click();
		await tick();

		expect(addFiles).not.toHaveBeenCalled();
	});

	it('closes without queuing when Cancel is clicked', async () => {
		let open = true;
		const screen = render(UploadModal, {
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

		cancelButton(screen.container).click();
		await tick();

		expect(open).toBe(false);
		expect(addFiles).not.toHaveBeenCalled();
	});

	it('clears the selection when the modal closes', async () => {
		const screen = render(UploadModal, { props: { ...baseProps } });
		await tick();

		await selectFiles(fileInput(screen.container), [new File(['x'], 'x.txt')]);
		expect(screen.container.textContent).toContain('1 file selected');

		await screen.rerender({ ...baseProps, open: false });
		await tick();

		expect(screen.container.textContent).not.toContain('file selected');
	});
});
