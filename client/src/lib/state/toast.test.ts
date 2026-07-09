import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock svelte-sonner's toast function so the store is testable in the node
// project (the real svelte-sonner toast writes into a DOM-backed store we
// don't want to spin up in unit tests).
const methods = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn()
}));
vi.mock('svelte-sonner', () => ({ toast: methods }));

import { toast } from './toast';

beforeEach(() => vi.clearAllMocks());

describe('toast', () => {
	it('maps add() color → sonner toast method', () => {
		toast.add({ title: 'A', description: 'd', color: 'success' });
		expect(methods.success).toHaveBeenCalledWith('A', { description: 'd' });
		toast.add({ title: 'B', color: 'error' });
		expect(methods.error).toHaveBeenCalledWith('B', { description: undefined });
		toast.add({ title: 'C', color: 'warning' });
		expect(methods.warning).toHaveBeenCalledWith('C', { description: undefined });
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
		expect(methods.success).toHaveBeenCalledWith('s', { description: 'ds' });
		expect(methods.error).toHaveBeenCalledWith('e', { description: undefined });
		expect(methods.warning).toHaveBeenCalledWith('w', { description: undefined });
		expect(methods.info).toHaveBeenCalledWith('i', { description: undefined });
	});
});
