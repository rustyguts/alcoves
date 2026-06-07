import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';

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
	return { decision: vi.fn(), ApiError };
});

vi.mock('$lib/api', () => ({
	api: { oauth: { decision: (...a: unknown[]) => mocks.decision(...a) } },
	ApiError: mocks.ApiError
}));

const request = {
	clientId: 'alc_oc_1',
	redirectUri: 'https://claude.ai/api/mcp/auth_callback',
	codeChallenge: 'chal',
	codeChallengeMethod: 'S256',
	scope: 'mcp',
	resource: 'https://alcoves.io/api/mcp',
	state: 'xyz'
};

const okData = {
	// `user` is merged in from the parent layout's data at runtime.
	user: null,
	ok: true as const,
	info: {
		consentToken: 'ct',
		client: { clientId: 'alc_oc_1', clientName: 'Claude' },
		scopes: ['mcp'],
		request
	},
	userName: 'Test User'
};

async function flush() {
	await tick();
	await Promise.resolve();
	await tick();
}

function clickButton(screen: ReturnType<typeof render>, label: string) {
	const btn = [...screen.container.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(label)
	)!;
	btn.click();
}

beforeEach(() => vi.clearAllMocks());

describe('oauth/authorize +page.svelte', () => {
	it('renders the client name, scope, and approve/deny actions', async () => {
		const screen = render(Page, { data: okData });
		await expect.element(screen.getByText('Connect to Alcoves')).toBeInTheDocument();
		await expect
			.element(screen.getByText(/Claude wants to connect to your account/))
			.toBeInTheDocument();
		await expect.element(screen.getByText(/acting as you/i)).toBeInTheDocument();
		expect(
			[...screen.container.querySelectorAll('button')].map((b) => b.textContent?.trim())
		).toEqual(expect.arrayContaining([expect.stringContaining('Deny')]));
	});

	it('surfaces the redirect host so an impostor client name can be spotted', async () => {
		const screen = render(Page, { data: okData });
		await expect.element(screen.getByText('claude.ai')).toBeInTheDocument();
	});

	it('sends approve=true with the full request when Approve is clicked', async () => {
		// Reject so the success-path navigation (window.location) is not triggered.
		mocks.decision.mockRejectedValue(new mocks.ApiError(400, { error_description: 'nope' }));
		const screen = render(Page, { data: okData });
		clickButton(screen, 'Approve');
		await flush();
		expect(mocks.decision).toHaveBeenCalledWith({
			consentToken: 'ct',
			approve: true,
			...request
		});
		await expect.element(screen.getByText('nope')).toBeInTheDocument();
	});

	it('sends approve=false when Deny is clicked', async () => {
		mocks.decision.mockRejectedValue(new mocks.ApiError(400, { error_description: 'denied path' }));
		const screen = render(Page, { data: okData });
		clickButton(screen, 'Deny');
		await flush();
		expect(mocks.decision).toHaveBeenCalledWith(
			expect.objectContaining({ approve: false, consentToken: 'ct' })
		);
	});

	it('renders the failure card when the request is invalid', async () => {
		const screen = render(Page, {
			data: {
				user: null,
				ok: false as const,
				error: 'This authorization request is invalid or has expired.'
			}
		});
		await expect.element(screen.getByText('Authorization failed')).toBeInTheDocument();
		await expect
			.element(screen.getByText('This authorization request is invalid or has expired.'))
			.toBeInTheDocument();
	});
});
