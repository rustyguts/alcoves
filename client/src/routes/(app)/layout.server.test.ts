import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', () => ({ createApi: () => ({ libraries: { list: listMock } }) }));

import { load } from './+layout.server';

const cookiesGetMock = vi.hoisted(() => vi.fn());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (over: any) =>
	load({
		url: new URL('http://x/'),
		fetch: vi.fn(),
		cookies: { get: cookiesGetMock },
		...over
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);

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
			librariesError: boolean;
		};
		expect(result.user).toEqual({ id: 'u', role: 'member' });
		expect(result.libraries).toEqual([{ id: 'L1' }]);
		expect(result.librariesError).toBe(false);
	});

	it('degrades to an empty library list and flags the error when the API fails', async () => {
		listMock.mockRejectedValue(new Error('down'));
		const result = (await call({ locals: { user: { id: 'u' } } })) as {
			libraries: unknown[];
			librariesError: boolean;
		};
		expect(result.libraries).toEqual([]);
		expect(result.librariesError).toBe(true);
	});

	// F18: sidebar_state cookie is read at SSR time and threaded into the
	// layout's Sidebar.Provider open prop so collapse survives reload.
	it('defaults sidebarOpen to true when the cookie is absent', async () => {
		listMock.mockResolvedValue([]);
		cookiesGetMock.mockReturnValue(undefined);
		const result = (await call({ locals: { user: { id: 'u' } } })) as { sidebarOpen: boolean };
		expect(cookiesGetMock).toHaveBeenCalledWith('sidebar_state');
		expect(result.sidebarOpen).toBe(true);
	});

	it('reads sidebarOpen false from the sidebar_state cookie', async () => {
		listMock.mockResolvedValue([]);
		cookiesGetMock.mockReturnValue('false');
		const result = (await call({ locals: { user: { id: 'u' } } })) as { sidebarOpen: boolean };
		expect(result.sidebarOpen).toBe(false);
	});

	it('treats any non-"false" cookie value as open', async () => {
		listMock.mockResolvedValue([]);
		cookiesGetMock.mockReturnValue('true');
		const result = (await call({ locals: { user: { id: 'u' } } })) as { sidebarOpen: boolean };
		expect(result.sidebarOpen).toBe(true);
	});
});
