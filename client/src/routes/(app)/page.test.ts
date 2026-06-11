import { describe, it, expect, vi } from 'vitest';
import { load } from './+page';
import type { Library } from '$lib/types/api';

function lib(over: Partial<Library>): Library {
	return {
		id: 'L1',
		name: 'Lib',
		emoji: null,
		isDefault: false,
		faceRecognitionEnabled: false,
		objectDetectionEnabled: false,
		sharingEnabled: false,
		ownerId: 'u1',
		createdAt: '',
		updatedAt: '',
		...over
	};
}

const run = (libraries: Library[]) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	load({ parent: vi.fn().mockResolvedValue({ libraries }) } as any);

describe('(app) home +page load', () => {
	it('redirects to the default library when one is flagged', async () => {
		await expect(
			run([lib({ id: 'a', isDefault: false }), lib({ id: 'b', isDefault: true })])
		).rejects.toMatchObject({ status: 307, location: '/libraries/b' });
	});

	it('redirects to the first library when none is flagged default', async () => {
		await expect(run([lib({ id: 'first' }), lib({ id: 'second' })])).rejects.toMatchObject({
			status: 307,
			location: '/libraries/first'
		});
	});

	it('returns empty (no redirect) when there are no libraries', async () => {
		await expect(run([])).resolves.toEqual({});
	});
});
