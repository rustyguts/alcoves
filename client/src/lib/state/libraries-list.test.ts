import { describe, it, expect, vi, beforeEach } from 'vitest';

import { registerLibrariesRefresh, refreshLibraries } from './libraries-list.svelte';

beforeEach(() => {
	// Reset the module-level slot between tests (last registration wins).
	registerLibrariesRefresh(async () => {});
	vi.clearAllMocks();
});

describe('libraries-list singleton', () => {
	it('refreshLibraries invokes the registered callback', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		registerLibrariesRefresh(fn);
		await refreshLibraries();
		expect(fn).toHaveBeenCalledOnce();
	});

	it('awaits the registered callback before resolving', async () => {
		const order: string[] = [];
		registerLibrariesRefresh(async () => {
			await Promise.resolve();
			order.push('callback');
		});
		await refreshLibraries();
		order.push('after');
		expect(order).toEqual(['callback', 'after']);
	});

	it('last registration wins', async () => {
		const first = vi.fn().mockResolvedValue(undefined);
		const second = vi.fn().mockResolvedValue(undefined);
		registerLibrariesRefresh(first);
		registerLibrariesRefresh(second);
		await refreshLibraries();
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
	});

	it('refreshLibraries is a no-op (resolves) when no callback is registered', async () => {
		registerLibrariesRefresh(null as unknown as () => Promise<void>);
		await expect(refreshLibraries()).resolves.toBeUndefined();
	});

	it('propagates rejection from the registered callback', async () => {
		registerLibrariesRefresh(async () => {
			throw new Error('refresh failed');
		});
		await expect(refreshLibraries()).rejects.toThrow('refresh failed');
	});

	it('can be invoked repeatedly', async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		registerLibrariesRefresh(fn);
		await refreshLibraries();
		await refreshLibraries();
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
