import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Skeleton toaster so the store is testable in the node project
// (createToaster otherwise builds a UI machine we don't want in unit tests).
const methods = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn()
}));
vi.mock('@skeletonlabs/skeleton-svelte', () => ({ createToaster: () => methods }));

import { toast, toaster } from './toast';

beforeEach(() => vi.clearAllMocks());

describe('toast', () => {
	it('exposes the singleton toaster', () => {
		expect(toaster).toBe(methods);
	});

	it('maps add() color → toaster method', () => {
		toast.add({ title: 'A', description: 'd', color: 'success' });
		expect(methods.success).toHaveBeenCalledWith({ title: 'A', description: 'd' });
		toast.add({ title: 'B', color: 'error' });
		expect(methods.error).toHaveBeenCalledWith({ title: 'B', description: undefined });
		toast.add({ title: 'C', color: 'warning' });
		expect(methods.warning).toHaveBeenCalledWith({ title: 'C', description: undefined });
	});

	it('routes info / neutral / primary / unset colors to the info toast', () => {
		toast.add({ title: 'i', color: 'info' });
		toast.add({ title: 'n', color: 'neutral' });
		toast.add({ title: 'p', color: 'primary' });
		toast.add({ title: 'u' });
		expect(methods.info).toHaveBeenCalledTimes(4);
	});

	it('provides typed shorthand helpers', () => {
		toast.success('s', 'ds');
		toast.error('e');
		toast.warning('w');
		toast.info('i');
		expect(methods.success).toHaveBeenCalledWith({ title: 's', description: 'ds' });
		expect(methods.error).toHaveBeenCalledWith({ title: 'e', description: undefined });
		expect(methods.warning).toHaveBeenCalledWith({ title: 'w', description: undefined });
		expect(methods.info).toHaveBeenCalledWith({ title: 'i', description: undefined });
	});
});
