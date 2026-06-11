import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

// The page is a thin shell around AdminJobsPanel. We render the real panel and
// mock its data deps (API, toast, SSE) so this test stays focused on the page
// chrome — the "Back to Admin" link — while confirming the panel mounts.
vi.mock('$lib/api', () => ({
	api: {
		admin: {
			controlJob: vi.fn().mockResolvedValue(undefined),
			purgeQueue: vi.fn().mockResolvedValue({ total: 0 })
		}
	},
	apiUrl: (path: string) => path
}));

vi.mock('$lib/state/toast', () => ({
	toast: { add: vi.fn() }
}));

// AdminJobsPanel opens an SSE stream on mount; provide a no-op EventSource so the
// real panel mounts cleanly inside the page under test.
class MockEventSource {
	url: string;
	onopen: ((e: Event) => void) | null = null;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;
	constructor(url: string) {
		this.url = url;
	}
	close() {}
}
vi.stubGlobal('EventSource', MockEventSource);

describe('/admin/jobs page', () => {
	it('renders a "Back to Admin" link pointing at /admin', async () => {
		const screen = render(Page);
		const link = screen.container.querySelector('a[href="/admin"]') as HTMLAnchorElement;
		expect(link).not.toBeNull();
		expect(link.textContent?.trim()).toContain('Back to Admin');
	});

	it('mounts the AdminJobsPanel with its heading', async () => {
		const screen = render(Page);
		const heading = screen.container.querySelector('h1');
		expect(heading?.textContent?.trim()).toBe('Background Jobs');
	});
});
