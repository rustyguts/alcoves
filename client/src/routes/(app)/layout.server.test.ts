import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', () => ({ createApi: () => ({ libraries: { list: listMock } }) }));

import { load } from './+layout.server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (over: any) => load({ url: new URL('http://x/'), fetch: vi.fn(), ...over } as any);

beforeEach(() => vi.clearAllMocks());

describe('(app) layout.server load', () => {
	it('redirects anonymous users to /login preserving the target', async () => {
		await expect(
			call({ locals: { user: null }, url: new URL('http://x/profile?tab=1') })
		).rejects.toMatchObject({ status: 302, location: '/login?redirect=%2Fprofile%3Ftab%3D1' });
	});

	it('returns the user and libraries when authed', async () => {
		listMock.mockResolvedValue([{ id: 'L1' }]);
		const result = (await call({ locals: { user: { id: 'u', role: 'member' } } })) as {
			user: unknown;
			libraries: unknown[];
		};
		expect(result.user).toEqual({ id: 'u', role: 'member' });
		expect(result.libraries).toEqual([{ id: 'L1' }]);
	});

	it('degrades to an empty library list when the API errors', async () => {
		listMock.mockRejectedValue(new Error('down'));
		const result = (await call({ locals: { user: { id: 'u' } } })) as { libraries: unknown[] };
		expect(result.libraries).toEqual([]);
	});
});
