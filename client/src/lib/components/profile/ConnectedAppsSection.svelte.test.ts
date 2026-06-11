import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import ConnectedAppsSection from './ConnectedAppsSection.svelte';

const mocks = vi.hoisted(() => {
	class ApiError extends Error {
		status: number;
		data: Record<string, unknown> | null;
		constructor(status: number, data: Record<string, unknown> | null) {
			super('api error');
			this.status = status;
			this.data = data;
		}
	}
	return { connections: vi.fn(), revokeConnection: vi.fn(), toastAdd: vi.fn(), ApiError };
});

vi.mock('$lib/api', () => ({
	api: {
		oauth: {
			connections: (...a: unknown[]) => mocks.connections(...a),
			revokeConnection: (...a: unknown[]) => mocks.revokeConnection(...a)
		}
	},
	ApiError: mocks.ApiError
}));

vi.mock('$lib/state/toast', () => ({
	toast: { add: (...a: unknown[]) => mocks.toastAdd(...a) }
}));

const conn = {
	clientId: 'alc_oc_1',
	clientName: 'Claude',
	scope: 'mcp',
	lastUsedAt: null,
	createdAt: '2026-01-01T00:00:00Z'
};

async function flush() {
	await tick();
	await Promise.resolve();
	await tick();
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.connections.mockResolvedValue({ connections: [conn] });
	mocks.revokeConnection.mockResolvedValue(undefined);
});

describe('ConnectedAppsSection', () => {
	it('lists connected apps with a count badge', async () => {
		const screen = render(ConnectedAppsSection);
		await flush();
		await expect.element(screen.getByText('Connected apps')).toBeInTheDocument();
		await expect.element(screen.getByText('Claude')).toBeInTheDocument();
		await expect.element(screen.getByText('1 connected')).toBeInTheDocument();
	});

	it('shows an empty state when there are no connections', async () => {
		mocks.connections.mockResolvedValue({ connections: [] });
		const screen = render(ConnectedAppsSection);
		await flush();
		await expect.element(screen.getByText('No connected apps')).toBeInTheDocument();
	});

	it('hides the whole panel when OAuth is disabled (404)', async () => {
		mocks.connections.mockRejectedValue(new mocks.ApiError(404, null));
		const screen = render(ConnectedAppsSection);
		await flush();
		expect(screen.container.textContent).not.toContain('Connected apps');
	});

	it('shows a "last used" date when present', async () => {
		mocks.connections.mockResolvedValue({
			connections: [{ ...conn, lastUsedAt: '2026-02-15T00:00:00Z' }]
		});
		const screen = render(ConnectedAppsSection);
		await flush();
		await expect.element(screen.getByText('Last used Feb 15, 2026')).toBeInTheDocument();
	});

	it('surfaces an error (not a false empty state) on a non-404 failure', async () => {
		mocks.connections.mockRejectedValue(new mocks.ApiError(500, null));
		const screen = render(ConnectedAppsSection);
		await flush();
		// Panel stays visible but shows an error instead of "0 connected".
		await expect
			.element(screen.getByRole('heading', { name: 'Connected apps' }))
			.toBeInTheDocument();
		await expect.element(screen.getByText("Couldn't load connected apps")).toBeInTheDocument();
		expect(screen.container.textContent).not.toContain('0 connected');
		expect(screen.container.textContent).not.toContain('No connected apps');
	});

	it('disconnects an app and refreshes', async () => {
		const screen = render(ConnectedAppsSection);
		await flush();
		const btn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Disconnect')
		)!;
		btn.click();
		await flush();
		expect(mocks.revokeConnection).toHaveBeenCalledWith('alc_oc_1');
		expect(mocks.connections).toHaveBeenCalledTimes(2);
		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'App disconnected', color: 'success' });
	});

	it('shows an error toast when disconnect fails', async () => {
		mocks.revokeConnection.mockRejectedValue(new Error('boom'));
		const screen = render(ConnectedAppsSection);
		await flush();
		const btn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Disconnect')
		)!;
		btn.click();
		await flush();
		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Failed to disconnect', color: 'error' });
	});
});
