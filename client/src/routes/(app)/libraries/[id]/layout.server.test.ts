import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', () => ({
	createApi: () => ({ libraries: { get: getMock } }),
	ApiError: class ApiError extends Error {
		status: number;
		data: Record<string, unknown> | null;
		constructor(status: number, data: Record<string, unknown> | null) {
			super('api error');
			this.status = status;
			this.data = data;
		}
	}
}));

import { load } from './+layout.server';
import { ApiError } from '$lib/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = () => load({ params: { id: 'L1' }, fetch: vi.fn() } as any);

beforeEach(() => vi.clearAllMocks());

describe('libraries/[id] layout.server load', () => {
	it('returns the library on success', async () => {
		getMock.mockResolvedValue({ id: 'L1', name: 'Lib' });
		expect(await call()).toEqual({ library: { id: 'L1', name: 'Lib' } });
	});

	it('404s on an ApiError 404/403', async () => {
		getMock.mockRejectedValue(new ApiError(404, null));
		await expect(call()).rejects.toMatchObject({ status: 404 });
		getMock.mockRejectedValue(new ApiError(403, null));
		await expect(call()).rejects.toMatchObject({ status: 404 });
	});

	it('rethrows non-ApiError failures', async () => {
		getMock.mockRejectedValue(new Error('boom'));
		await expect(call()).rejects.toThrow('boom');
	});
});
