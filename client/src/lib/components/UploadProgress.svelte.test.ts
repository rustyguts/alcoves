import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import UploadProgress from './UploadProgress.svelte';

type UploadItem = {
	id: string;
	file: { name: string };
	libraryName: string;
	status: 'pending' | 'uploading' | 'error' | 'done';
	progress: number;
	error?: string;
};

// Mutable fixture backing the mocked global store. Getters mirror the real
// `uploadQueue` singleton so the component sees a fresh derived view per render.
const fixture = {
	items: [] as UploadItem[],
	uploadSpeed: 0,
	retryFile: vi.fn(),
	removeFile: vi.fn(),
	retryAll: vi.fn(),
	clearErrors: vi.fn()
};

vi.mock('$lib/state/upload-queue.svelte', () => ({
	uploadQueue: {
		get activeUploads() {
			return fixture.items;
		},
		get hasActiveUploads() {
			return fixture.items.length > 0;
		},
		get erroredUploads() {
			return fixture.items.filter((u) => u.status === 'error');
		},
		get uploadSpeed() {
			return fixture.uploadSpeed;
		},
		retryFile: (id: string) => fixture.retryFile(id),
		removeFile: (id: string) => fixture.removeFile(id),
		retryAll: () => fixture.retryAll(),
		clearErrors: () => fixture.clearErrors()
	}
}));

beforeEach(() => {
	fixture.items = [];
	fixture.uploadSpeed = 0;
	fixture.retryFile.mockReset();
	fixture.removeFile.mockReset();
	fixture.retryAll.mockReset();
	fixture.clearErrors.mockReset();
});

function buttonByText(screen: ReturnType<typeof render>, text: string): HTMLButtonElement {
	const btn = Array.from(screen.container.querySelectorAll('button')).find(
		(b) => b.textContent?.trim() === text
	) as HTMLButtonElement | undefined;
	expect(btn, `button "${text}"`).toBeTruthy();
	return btn!;
}

describe('UploadProgress', () => {
	it('renders nothing when there are no active uploads', () => {
		const screen = render(UploadProgress);
		expect(screen.container.querySelector('.fixed')).toBeNull();
	});

	it('renders the upload count, speed, and uploading progress bar', async () => {
		fixture.items = [
			{
				id: '1',
				file: { name: 'photo.jpg' },
				libraryName: 'Media',
				status: 'uploading',
				progress: 32
			}
		];
		fixture.uploadSpeed = 2048;

		const screen = render(UploadProgress);
		const text = (screen.container.textContent ?? '').replace(/\s+/g, ' ');

		expect(text).toContain('Uploading 1 file');
		expect(text).toContain('2 KB/s');
		expect(text).toContain('32%');
		expect(text).toContain('photo.jpg');
		expect(text).toContain('Media');

		const bar = screen.container.querySelector('[role="progressbar"] > div') as HTMLElement;
		expect(bar.style.width).toBe('32%');
	});

	it('pluralizes the file label for multiple uploads', () => {
		fixture.items = [
			{ id: 'a', file: { name: 'a.jpg' }, libraryName: 'L', status: 'pending', progress: 0 },
			{ id: 'b', file: { name: 'b.jpg' }, libraryName: 'L', status: 'pending', progress: 0 }
		];
		const screen = render(UploadProgress);
		const text = (screen.container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('Uploading 2 files');
	});

	it('toggles the expanded section when the header is clicked', async () => {
		fixture.items = [
			{ id: '2', file: { name: 'doc.pdf' }, libraryName: 'Docs', status: 'pending', progress: 0 }
		];

		const screen = render(UploadProgress);
		expect(screen.container.textContent).toContain('Waiting...');

		const header = screen.container.querySelector('button') as HTMLButtonElement;
		header.click();
		await vi.waitFor(() => {
			expect(screen.container.textContent).not.toContain('Waiting...');
		});

		header.click();
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('Waiting...');
		});
	});

	it('shows the error summary and forwards retryAll / clearErrors', () => {
		fixture.items = [
			{
				id: 'e1',
				file: { name: 'bad.csv' },
				libraryName: 'Ops',
				status: 'error',
				progress: 0,
				error: 'Upload failed (500)'
			}
		];

		const screen = render(UploadProgress);
		expect(screen.container.textContent).toContain('1 failed');

		buttonByText(screen, 'Retry All').click();
		buttonByText(screen, 'Clear').click();

		expect(fixture.retryAll).toHaveBeenCalledOnce();
		expect(fixture.clearErrors).toHaveBeenCalledOnce();
	});

	it('shows retry/remove controls per errored upload and forwards the item id', () => {
		fixture.items = [
			{
				id: '3',
				file: { name: 'report.csv' },
				libraryName: 'Ops',
				status: 'error',
				progress: 0,
				error: 'Upload failed (500)'
			}
		];

		const screen = render(UploadProgress);
		expect(screen.container.textContent).toContain('Upload failed (500)');

		buttonByText(screen, 'Retry').click();
		buttonByText(screen, 'Remove').click();

		expect(fixture.retryFile).toHaveBeenCalledWith('3');
		expect(fixture.removeFile).toHaveBeenCalledWith('3');
	});

	it('renders a completion indicator for done uploads', () => {
		fixture.items = [
			{ id: 'd1', file: { name: 'ok.jpg' }, libraryName: 'L', status: 'done', progress: 100 }
		];
		const screen = render(UploadProgress);
		expect(screen.container.textContent).toContain('Complete');
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});
});
