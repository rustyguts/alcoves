import { describe, it, expect } from 'vitest';
import { load } from './+layout.server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (user: any) => load({ locals: { user } } as any);

describe('(app)/admin layout.server load', () => {
	it('redirects non-owners to /', async () => {
		await expect(call({ role: 'member' })).rejects.toMatchObject({ status: 302, location: '/' });
	});
	it('redirects anonymous users to /', async () => {
		await expect(call(null)).rejects.toMatchObject({ status: 302, location: '/' });
	});
	it('allows instance owners', async () => {
		expect(await call({ role: 'owner' })).toEqual({});
	});
});
