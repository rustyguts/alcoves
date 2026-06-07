import { describe, it, expect, vi, beforeEach } from 'vitest';

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
	return { authorize: vi.fn(), ApiError };
});

vi.mock('$lib/api', () => ({
	createApi: () => ({ oauth: { authorize: (...a: unknown[]) => mocks.authorize(...a) } }),
	ApiError: mocks.ApiError
}));

import { load } from './+page.server';

const consentInfo = {
	consentToken: 'ct',
	client: { clientId: 'alc_oc_1', clientName: 'Claude' },
	scopes: ['mcp'],
	request: {
		clientId: 'alc_oc_1',
		redirectUri: 'https://claude.ai/api/mcp/auth_callback',
		codeChallenge: 'chal',
		codeChallengeMethod: 'S256',
		scope: 'mcp',
		resource: 'https://alcoves.io/api/mcp',
		state: 'xyz'
	}
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEvent(opts: { search: string; user: unknown }): any {
	return {
		url: new URL(`http://localhost/oauth/authorize${opts.search}`),
		locals: { user: opts.user },
		fetch: vi.fn()
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.authorize.mockResolvedValue(consentInfo);
});

describe('oauth/authorize +page.server load', () => {
	it('redirects anonymous users to login with a return path', async () => {
		const event = makeEvent({ search: '?client_id=alc_oc_1', user: null });
		await expect(load(event)).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('/login?redirect=')
		});
		expect(mocks.authorize).not.toHaveBeenCalled();
	});

	it('passes through the OAuth params and returns consent info when logged in', async () => {
		const event = makeEvent({
			search:
				'?client_id=alc_oc_1&redirect_uri=https://claude.ai/cb&response_type=code&code_challenge=chal&code_challenge_method=S256&scope=mcp&state=xyz&resource=https://alcoves.io/api/mcp',
			user: { displayName: 'Test User', email: 't@example.com' }
		});
		const result = await load(event);
		expect(mocks.authorize).toHaveBeenCalledWith(
			expect.objectContaining({
				client_id: 'alc_oc_1',
				redirect_uri: 'https://claude.ai/cb',
				code_challenge: 'chal',
				state: 'xyz'
			})
		);
		expect(result).toMatchObject({ ok: true, info: consentInfo, userName: 'Test User' });
	});

	it('returns an error payload (not a throw) when the backend rejects the request', async () => {
		mocks.authorize.mockRejectedValue(
			new mocks.ApiError(400, { error_description: 'redirect_uri does not match a registered URI' })
		);
		const event = makeEvent({ search: '?client_id=bad', user: { email: 't@example.com' } });
		const result = await load(event);
		expect(result).toMatchObject({
			ok: false,
			error: 'redirect_uri does not match a registered URI'
		});
	});
});
