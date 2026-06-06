import { describe, it, expect } from 'vitest';
import { load } from './+layout.server';

// NOTE: route-load tests must NOT use the reserved `+` filename prefix, so this
// is `layout.server.test.ts` (the router ignores non-`+` files; the import of
// `./+layout.server` still resolves). Same pattern for all +page/+layout tests.
describe('root +layout.server load', () => {
	it('exposes locals.user as data.user', async () => {
		const user = { id: 'u1', email: 'a@b.c', displayName: 'A', avatarUrl: null, role: 'owner' };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await load({ locals: { user } } as any);
		expect(result).toEqual({ user });
	});

	it('passes through a null user', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await load({ locals: { user: null } } as any);
		expect(result).toEqual({ user: null });
	});
});
