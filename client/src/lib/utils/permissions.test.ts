import { describe, it, expect } from 'vitest';
import { canManageLibrary, isInstanceOwner } from './permissions';
import type { Library } from '$lib/types/api';

function lib(over: Partial<Library> = {}): Library {
	return {
		id: 'L',
		name: 'Lib',
		emoji: null,
		isDefault: false,
		faceRecognitionEnabled: false,
		objectDetectionEnabled: false,
		sharingEnabled: false,
		ownerId: 'owner-1',
		createdAt: '',
		updatedAt: '',
		...over
	};
}

describe('canManageLibrary', () => {
	it('is true for the library owner by id', () => {
		expect(canManageLibrary(lib({ ownerId: 'u1' }), { id: 'u1' })).toBe(true);
	});
	it('is true for an admin/owner role', () => {
		expect(canManageLibrary(lib({ currentUserRole: 'admin' }), { id: 'x' })).toBe(true);
		expect(canManageLibrary(lib({ currentUserRole: 'owner' }), { id: 'x' })).toBe(true);
	});
	it('is false for a viewer or no role', () => {
		expect(canManageLibrary(lib({ currentUserRole: 'viewer' }), { id: 'x' })).toBe(false);
		expect(canManageLibrary(lib(), { id: 'x' })).toBe(false);
	});
	it('is false without a library or user', () => {
		expect(canManageLibrary(null, { id: 'u1' })).toBe(false);
		expect(canManageLibrary(lib(), null)).toBe(false);
	});
});

describe('isInstanceOwner', () => {
	it('reflects the instance role', () => {
		expect(isInstanceOwner({ role: 'owner' })).toBe(true);
		expect(isInstanceOwner({ role: 'member' })).toBe(false);
		expect(isInstanceOwner(null)).toBe(false);
	});
});
