import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import AdminJobsPanel from './AdminJobsPanel.svelte';

const mocks = vi.hoisted(() => ({
	controlJob: vi.fn().mockResolvedValue(undefined),
	purgeQueue: vi.fn().mockResolvedValue({ total: 5 }),
	toastAdd: vi.fn()
}));

vi.mock('$lib/api', () => ({
	api: {
		admin: {
			controlJob: mocks.controlJob,
			purgeQueue: mocks.purgeQueue
		}
	},
	apiUrl: (path: string) => path
}));

vi.mock('$lib/state/toast', () => ({
	toast: { add: mocks.toastAdd }
}));

class MockEventSource {
	static instances: MockEventSource[] = [];
	url: string;
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	readyState = 0;

	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}

	open() {
		this.readyState = 1;
		this.onopen?.(new Event('open'));
	}

	close() {
		this.readyState = 2;
	}

	simulateMessage(data: unknown) {
		this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
	}

	simulateError() {
		this.onerror?.(new Event('error'));
	}
}

function getSnapshot(overrides?: Partial<{ queues: unknown[]; jobs: unknown[] }>) {
	return {
		queues: [
			{ name: '{video-processing}', waiting: 2, active: 1, completed: 10, failed: 1, delayed: 0 },
			{ name: '{face-detection}', waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 }
		],
		jobs: [
			{
				id: 'job-1',
				queueName: '{video-processing}',
				name: 'process-video',
				data: { fileId: 'file-1' },
				progress: 60,
				attemptsMade: 0,
				failedReason: null,
				timestamp: 1700000000000,
				processedOn: 1700000001000,
				finishedOn: null,
				state: 'active'
			},
			{
				id: 'job-2',
				queueName: '{video-processing}',
				name: 'process-video',
				data: { fileId: 'file-2' },
				progress: 0,
				attemptsMade: 2,
				failedReason: 'ffmpeg crash',
				timestamp: 1699999000000,
				processedOn: 1699999001000,
				finishedOn: 1699999010000,
				state: 'failed'
			},
			{
				id: 'job-3',
				queueName: '{face-detection}',
				name: 'detect-faces',
				data: {},
				progress: 0,
				attemptsMade: 0,
				failedReason: null,
				timestamp: 1700000500000,
				processedOn: null,
				finishedOn: null,
				state: 'waiting'
			}
		],
		...overrides
	};
}

const OriginalEventSource = globalThis.EventSource;

beforeEach(() => {
	vi.clearAllMocks();
	MockEventSource.instances = [];
	vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
	vi.stubGlobal('EventSource', OriginalEventSource);
	vi.unstubAllGlobals();
});

/** Render the panel and return the screen + the EventSource the component opened. */
function renderPanel(props: Record<string, unknown> = {}) {
	const screen = render(AdminJobsPanel, { props: { embedded: false, ...props } });
	const es = MockEventSource.instances[0]!;
	return { screen, es };
}

describe('AdminJobsPanel', () => {
	it('renders heading as h1 when not embedded', async () => {
		const { screen } = renderPanel();
		const h1 = screen.container.querySelector('h1');
		expect(h1?.textContent?.trim()).toBe('Background Jobs');
		expect(screen.container.querySelector('h2')).toBeNull();
	});

	it('renders heading as h2 when embedded', async () => {
		const { screen } = renderPanel({ embedded: true });
		const h2 = screen.container.querySelector('h2');
		expect(h2?.textContent?.trim()).toBe('Background Jobs');
		expect(screen.container.querySelector('h1')).toBeNull();
	});

	it('opens an SSE connection to the jobs stream on mount', async () => {
		const { es } = renderPanel();
		expect(es).toBeDefined();
		expect(es.url).toBe('/api/admin/jobs/stream');
	});

	it('shows Disconnected before the stream opens', async () => {
		const { screen } = renderPanel();
		expect(screen.container.textContent).toContain('Disconnected');
	});

	it('shows Live status after SSE opens', async () => {
		const { screen, es } = renderPanel();
		es.open();
		await tick();
		expect(screen.container.textContent).toContain('Live');
	});

	it('shows Disconnected status on SSE error', async () => {
		const { screen, es } = renderPanel();
		es.open();
		await tick();
		es.simulateError();
		await tick();
		expect(screen.container.textContent).toContain('Disconnected');
	});

	it('renders the queue table from snapshot data', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		expect(screen.container.textContent).toContain('video processing');
		expect(screen.container.textContent).toContain('face detection');
	});

	it('renders stat counters from snapshot queues', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const text = screen.container.textContent ?? '';
		expect(text).toContain('Active');
		expect(text).toContain('Waiting');
		expect(text).toContain('Failed');
		expect(text).toContain('Delayed');
	});

	it('renders the jobs table with job entries and a filtered count', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		expect(screen.container.textContent).toContain('process-video');
		expect(screen.container.textContent).toContain('detect-faces');
		const normalized = (screen.container.textContent ?? '').replace(/\s+/g, ' ');
		expect(normalized).toContain('3 jobs');
	});

	it('shows a progress bar for active jobs', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const progress = screen.container.querySelector('progress');
		expect(progress).not.toBeNull();
		expect(progress?.getAttribute('value')).toBe('60');
		expect(screen.container.textContent).toContain('60%');
	});

	it('expands job detail on row click', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const jobsTable = screen.container.querySelectorAll('table')[1]!;
		const firstRow = jobsTable.querySelector('tbody tr') as HTMLElement;
		firstRow.click();
		await tick();
		expect(screen.container.textContent).toContain('job-1');
	});

	it('shows the failure reason when expanding a failed job', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const jobsTable = screen.container.querySelectorAll('table')[1]!;
		const failedRow = [...jobsTable.querySelectorAll('tbody tr')].find((r) =>
			r.textContent?.includes('failed')
		) as HTMLElement;
		expect(failedRow).toBeDefined();
		failedRow.click();
		await tick();
		expect(screen.container.textContent).toContain('ffmpeg crash');
	});

	it('calls the retry API and toasts on success', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const retryBtn = screen.container.querySelector(
			'button[aria-label="Retry"]'
		) as HTMLButtonElement;
		expect(retryBtn).not.toBeNull();
		retryBtn.click();
		await tick();
		expect(mocks.controlJob).toHaveBeenCalledWith('{video-processing}', 'job-2', {
			action: 'retry'
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Job retried', color: 'success' });
	});

	it('calls the remove API and toasts on success', async () => {
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const removeBtn = screen.container.querySelector(
			'button[aria-label="Remove"]'
		) as HTMLButtonElement;
		expect(removeBtn).not.toBeNull();
		removeBtn.click();
		await tick();
		expect(mocks.controlJob).toHaveBeenCalledWith('{video-processing}', 'job-2', {
			action: 'remove'
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Job removed', color: 'success' });
	});

	it('shows the empty state when no jobs match the filters', async () => {
		const { screen, es } = renderPanel();
		es.open();
		await tick();
		es.simulateMessage(getSnapshot({ jobs: [] }));
		await tick();
		expect(screen.container.textContent).toContain('No jobs matching current filters.');
	});

	it('shows a loading spinner when disconnected and no jobs', async () => {
		const { screen } = renderPanel();
		await tick();
		// Before the stream opens or sends data: connected=false, jobs=[].
		const spinner = screen.container.querySelector('.animate-spin');
		expect(spinner).not.toBeNull();
	});

	it('calls the purge API after confirmation', async () => {
		vi.stubGlobal('EventSource', MockEventSource);
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const purgeBtn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Purge')
		) as HTMLButtonElement;
		expect(purgeBtn).toBeDefined();
		purgeBtn.click();
		await tick();
		expect(mocks.purgeQueue).toHaveBeenCalledWith('{video-processing}');
		confirmSpy.mockRestore();
	});

	it('does not purge when confirmation is cancelled', async () => {
		vi.stubGlobal('EventSource', MockEventSource);
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const { screen, es } = renderPanel();
		es.simulateMessage(getSnapshot());
		await tick();
		const purgeBtn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Purge')
		) as HTMLButtonElement;
		purgeBtn.click();
		await tick();
		expect(mocks.purgeQueue).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it('closes the EventSource on unmount', async () => {
		const { screen, es } = renderPanel();
		const closeSpy = vi.spyOn(es, 'close');
		screen.unmount();
		expect(closeSpy).toHaveBeenCalled();
	});
});
