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
	duplicateCount?: number;
};

// Mutable fixture backing the mocked global store. Getters mirror the real
// `uploadQueue` singleton (O(1) counters, monotonic session totals, and the raw
// `queue` the panel virtualizes).
const fixture = {
	queue: [] as UploadItem[],
	uploadSpeed: 0,
	submitted: 0,
	completed: 0,
	retryFile: vi.fn(),
	removeFile: vi.fn(),
	cancelFile: vi.fn(),
	cancelAll: vi.fn(),
	retryAll: vi.fn(),
	clearErrors: vi.fn()
};

const countBy = (s: string) => fixture.queue.filter((u) => u.status === s).length;

vi.mock('$lib/state/upload-queue.svelte', () => ({
	uploadQueue: {
		get queue() {
			return fixture.queue;
		},
		get totalCount() {
			return fixture.queue.length;
		},
		get pendingCount() {
			return countBy('pending');
		},
		get uploadingCount() {
			return countBy('uploading');
		},
		get errorCount() {
			return countBy('error');
		},
		get doneCount() {
			return countBy('done');
		},
		get submittedCount() {
			return fixture.submitted;
		},
		get completedCount() {
			return fixture.completed;
		},
		get overallProgress() {
			return fixture.submitted > 0 ? Math.round((fixture.completed / fixture.submitted) * 100) : 0;
		},
		get hasActiveUploads() {
			return fixture.queue.length > 0;
		},
		get hasInFlightUploads() {
			return countBy('pending') + countBy('uploading') > 0;
		},
		get uploadSpeed() {
			return fixture.uploadSpeed;
		},
		retryFile: (id: string) => fixture.retryFile(id),
		removeFile: (id: string) => fixture.removeFile(id),
		cancelFile: (id: string) => fixture.cancelFile(id),
		cancelAll: () => fixture.cancelAll(),
		retryAll: () => fixture.retryAll(),
		clearErrors: () => fixture.clearErrors()
	}
}));

beforeEach(() => {
	fixture.queue = [];
	fixture.uploadSpeed = 0;
	fixture.submitted = 0;
	fixture.completed = 0;
	fixture.retryFile.mockReset();
	fixture.removeFile.mockReset();
	fixture.cancelFile.mockReset();
	fixture.cancelAll.mockReset();
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

function buttonByLabel(screen: ReturnType<typeof render>, label: string): HTMLButtonElement {
	const btn = screen.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
	expect(btn, `button [aria-label="${label}"]`).toBeTruthy();
	return btn!;
}

function rows(screen: ReturnType<typeof render>): HTMLElement[] {
	return Array.from(screen.container.querySelectorAll<HTMLElement>('[data-upload-row]'));
}

describe('UploadProgress', () => {
	it('renders nothing when there are no active uploads', () => {
		const screen = render(UploadProgress);
		expect(screen.container.querySelector('[role="region"]')).toBeNull();
	});

	it('renders header title, completed/submitted counts, speed, and an uploading progress bar', () => {
		fixture.queue = [
			{
				id: '1',
				file: { name: 'photo.jpg' },
				libraryName: 'Media',
				status: 'uploading',
				progress: 32
			}
		];
		fixture.submitted = 2;
		fixture.completed = 1;
		fixture.uploadSpeed = 2048;

		const screen = render(UploadProgress);
		const text = (screen.container.textContent ?? '').replace(/\s+/g, ' ');

		expect(text).toContain('Uploading');
		expect(text).toContain('1 of 2'); // completedCount of submittedCount
		expect(text).toContain('2 KB/s');
		expect(text).toContain('32%');
		expect(text).toContain('photo.jpg');

		const bars = Array.from(screen.container.querySelectorAll<HTMLElement>('[role="progressbar"]'));
		expect(bars.some((b) => b.getAttribute('aria-valuenow') === '32')).toBe(true);
	});

	it('shows a "complete" title once nothing is in flight', () => {
		fixture.queue = [
			{ id: 'd1', file: { name: 'ok.jpg' }, libraryName: 'L', status: 'done', progress: 100 }
		];
		fixture.submitted = 1;
		fixture.completed = 1;
		const screen = render(UploadProgress);
		expect(screen.container.textContent).toContain('Upload complete');
		expect(screen.container.textContent).toContain('Done');
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('renders a Cancel control for pending/uploading rows and forwards the id', () => {
		fixture.queue = [
			{ id: 'p1', file: { name: 'a.bin' }, libraryName: 'L', status: 'pending', progress: 0 }
		];
		const screen = render(UploadProgress);
		expect(screen.container.textContent).toContain('Queued');

		buttonByLabel(screen, 'Cancel upload').click();
		expect(fixture.cancelFile).toHaveBeenCalledWith('p1');
	});

	it('shows retry/remove controls and a non-color error indicator per errored upload', () => {
		fixture.queue = [
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
		// Error rows carry an icon (not color-only).
		const row = rows(screen)[0]!;
		expect(row.querySelector('svg')).not.toBeNull();

		buttonByLabel(screen, 'Retry upload').click();
		buttonByLabel(screen, 'Remove upload').click();

		expect(fixture.retryFile).toHaveBeenCalledWith('3');
		expect(fixture.removeFile).toHaveBeenCalledWith('3');
	});

	it('shows the error summary and forwards retryAll / clearErrors', () => {
		fixture.queue = [
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

		buttonByText(screen, 'Retry all').click();
		buttonByText(screen, 'Clear').click();

		expect(fixture.retryAll).toHaveBeenCalledOnce();
		expect(fixture.clearErrors).toHaveBeenCalledOnce();
	});

	it('offers Cancel all while uploads are in flight and forwards it', () => {
		fixture.queue = [
			{ id: 'u1', file: { name: 'big.mp4' }, libraryName: 'L', status: 'uploading', progress: 20 },
			{ id: 'p2', file: { name: 'q.bin' }, libraryName: 'L', status: 'pending', progress: 0 }
		];
		const screen = render(UploadProgress);
		buttonByText(screen, 'Cancel all').click();
		expect(fixture.cancelAll).toHaveBeenCalledOnce();
	});

	it('hides Cancel all when nothing is in flight', () => {
		fixture.queue = [
			{ id: 'd', file: { name: 'ok.jpg' }, libraryName: 'L', status: 'done', progress: 100 }
		];
		const screen = render(UploadProgress);
		const cancelAll = Array.from(screen.container.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Cancel all'
		);
		expect(cancelAll).toBeUndefined();
	});

	it('filters to failed uploads when the Failed tab is clicked', async () => {
		fixture.queue = [
			{ id: 'ok', file: { name: 'good.jpg' }, libraryName: 'L', status: 'uploading', progress: 10 },
			{
				id: 'er',
				file: { name: 'bad.jpg' },
				libraryName: 'L',
				status: 'error',
				progress: 0,
				error: 'x'
			}
		];

		const screen = render(UploadProgress);
		expect(rows(screen)).toHaveLength(2);

		buttonByText(screen, '1 failed').click();
		await vi.waitFor(() => {
			expect(rows(screen)).toHaveLength(1);
		});
		expect(screen.container.textContent).toContain('bad.jpg');
		expect(screen.container.textContent).not.toContain('good.jpg');
	});

	it('collapses the list when the header is clicked', async () => {
		fixture.queue = [
			{ id: '2', file: { name: 'doc.pdf' }, libraryName: 'Docs', status: 'pending', progress: 0 }
		];

		const screen = render(UploadProgress);
		expect(rows(screen)).toHaveLength(1);

		const header = screen.container.querySelector('button[aria-expanded]') as HTMLButtonElement;
		header.click();
		await vi.waitFor(() => {
			expect(rows(screen)).toHaveLength(0);
		});

		header.click();
		await vi.waitFor(() => {
			expect(rows(screen)).toHaveLength(1);
		});
	});

	it('virtualizes large queues — renders a small window with the right rows', () => {
		fixture.queue = Array.from({ length: 500 }, (_, i) => ({
			id: `f${i}`,
			file: { name: `file-${i}.bin` },
			libraryName: 'Bulk',
			status: 'pending' as const,
			progress: 0
		}));

		const screen = render(UploadProgress);
		const rendered = rows(screen).length;
		// A capped viewport at 56px rows fits a handful; with overscan it stays well
		// under 50 — proving we don't paint all 500 at once.
		expect(rendered).toBeGreaterThan(0);
		expect(rendered).toBeLessThan(50);
		// Windowing correctness: the first row is present, a far one is not.
		expect(screen.container.textContent).toContain('file-0.bin');
		expect(screen.container.textContent).not.toContain('file-499.bin');
	});

	it('reserves the full list height via virtual spacers (so scroll maps to all rows)', () => {
		const ROW_H = 56;
		const N = 500;
		fixture.queue = Array.from({ length: N }, (_, i) => ({
			id: `f${i}`,
			file: { name: `file-${i}.bin` },
			libraryName: 'Bulk',
			status: 'pending' as const,
			progress: 0
		}));

		const screen = render(UploadProgress);
		const scroller = screen.container.querySelector('.overflow-y-auto') as HTMLElement;
		expect(scroller).toBeTruthy();

		// First/last children are the top/bottom virtual spacers; the rows sit between.
		const kids = Array.from(scroller.children) as HTMLElement[];
		const topPad = parseInt(kids[0]!.style.height || '0', 10);
		const bottomPad = parseInt(kids[kids.length - 1]!.style.height || '0', 10);
		const rendered = rows(screen).length;

		// topPad + rendered rows + bottomPad must reconstruct the full 500-row height,
		// i.e. the windowed DOM + spacers represent the entire queue.
		expect(topPad + rendered * ROW_H + bottomPad).toBe(N * ROW_H);
		expect(rendered).toBeLessThan(50);
	});

	it('warns on beforeunload only while uploads are in flight', () => {
		fixture.queue = [
			{ id: 'u', file: { name: 'big.mp4' }, libraryName: 'L', status: 'uploading', progress: 5 }
		];
		render(UploadProgress);

		const evt = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(evt);
		expect(evt.defaultPrevented).toBe(true);
	});

	it('does not block beforeunload when nothing is in flight (errors/done only)', () => {
		fixture.queue = [
			{
				id: 'e',
				file: { name: 'bad.mp4' },
				libraryName: 'L',
				status: 'error',
				progress: 0,
				error: 'x'
			}
		];
		render(UploadProgress);

		const evt = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(evt);
		expect(evt.defaultPrevented).toBe(false);
	});
});
