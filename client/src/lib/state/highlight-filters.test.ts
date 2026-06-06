import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HighlightFilter } from '$lib/types/api';

const apiMock = vi.hoisted(() => ({
	highlightFilters: {
		list: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		remove: vi.fn()
	}
}));

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$lib/state/toast', () => ({
	toast: { add: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

import { createHighlightFilters, HIGHLIGHT_PRESETS } from './highlight-filters.svelte';

function makeFilter(over: Partial<HighlightFilter>): HighlightFilter {
	return {
		id: 'f1',
		libraryId: 'lib1',
		createdById: null,
		name: 'Filter',
		expression: '',
		proximitySeconds: 0,
		color: '#fff',
		createdAt: '',
		updatedAt: '',
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('HIGHLIGHT_PRESETS', () => {
	it('ships a non-empty preset list', () => {
		expect(HIGHLIGHT_PRESETS.length).toBe(7);
		expect(HIGHLIGHT_PRESETS.every((p) => p.name && p.expression && p.color)).toBe(true);
	});
});

describe('createHighlightFilters (CRUD)', () => {
	it('starts with empty state', () => {
		const store = createHighlightFilters(() => 'lib1');
		expect(store.filters).toEqual([]);
		expect(store.loading).toBe(false);
		expect(store.error).toBeNull();
	});

	it('refresh() short-circuits when libraryId is empty', async () => {
		const store = createHighlightFilters(() => '');
		await store.refresh();
		expect(apiMock.highlightFilters.list).not.toHaveBeenCalled();
		expect(store.loading).toBe(false);
	});

	it('refresh() loads filters and clears loading/error', async () => {
		const rows = [makeFilter({ id: 'a' }), makeFilter({ id: 'b' })];
		apiMock.highlightFilters.list.mockResolvedValue(rows);
		const store = createHighlightFilters(() => 'lib1');
		await store.refresh();
		expect(apiMock.highlightFilters.list).toHaveBeenCalledWith('lib1');
		expect(store.filters).toEqual(rows);
		expect(store.loading).toBe(false);
		expect(store.error).toBeNull();
	});

	it('refresh() reads the libraryId getter lazily', async () => {
		let id = '';
		apiMock.highlightFilters.list.mockResolvedValue([]);
		const store = createHighlightFilters(() => id);
		await store.refresh();
		expect(apiMock.highlightFilters.list).not.toHaveBeenCalled();
		id = 'lib2';
		await store.refresh();
		expect(apiMock.highlightFilters.list).toHaveBeenCalledWith('lib2');
	});

	it('refresh() defaults to [] when the API returns nullish', async () => {
		apiMock.highlightFilters.list.mockResolvedValue(null);
		const store = createHighlightFilters(() => 'lib1');
		await store.refresh();
		expect(store.filters).toEqual([]);
	});

	it('refresh() captures errors and clears loading', async () => {
		apiMock.highlightFilters.list.mockRejectedValue(new Error('nope'));
		const store = createHighlightFilters(() => 'lib1');
		await store.refresh();
		expect(store.error).toBeInstanceOf(Error);
		expect(store.loading).toBe(false);
	});

	it('create() appends the created filter and returns it', async () => {
		const created = makeFilter({ id: 'new' });
		apiMock.highlightFilters.create.mockResolvedValue(created);
		const store = createHighlightFilters(() => 'lib1');
		const result = await store.create({ name: 'New', expression: 'laughter', color: '#000' });
		expect(apiMock.highlightFilters.create).toHaveBeenCalledWith('lib1', {
			name: 'New',
			expression: 'laughter',
			color: '#000'
		});
		expect(result).toEqual(created);
		expect(store.filters).toEqual([created]);
	});

	it('update() replaces the matching filter', async () => {
		apiMock.highlightFilters.list.mockResolvedValue([
			makeFilter({ id: 'a', name: 'old' }),
			makeFilter({ id: 'b' })
		]);
		const updated = makeFilter({ id: 'a', name: 'new' });
		apiMock.highlightFilters.update.mockResolvedValue(updated);
		const store = createHighlightFilters(() => 'lib1');
		await store.refresh();
		const result = await store.update('a', { name: 'new' });
		expect(apiMock.highlightFilters.update).toHaveBeenCalledWith('lib1', 'a', { name: 'new' });
		expect(result).toEqual(updated);
		expect(store.filters.find((f) => f.id === 'a')!.name).toBe('new');
		expect(store.filters.find((f) => f.id === 'b')!.name).toBe('Filter');
	});

	it('remove() drops the deleted filter', async () => {
		apiMock.highlightFilters.list.mockResolvedValue([
			makeFilter({ id: 'a' }),
			makeFilter({ id: 'b' })
		]);
		apiMock.highlightFilters.remove.mockResolvedValue(undefined);
		const store = createHighlightFilters(() => 'lib1');
		await store.refresh();
		await store.remove('a');
		expect(apiMock.highlightFilters.remove).toHaveBeenCalledWith('lib1', 'a');
		expect(store.filters.map((f) => f.id)).toEqual(['b']);
	});

	it('loadPresets() creates every preset and ignores individual failures', async () => {
		let n = 0;
		apiMock.highlightFilters.create.mockImplementation(() => {
			n += 1;
			if (n === 2) return Promise.reject(new Error('dupe'));
			return Promise.resolve(makeFilter({ id: `p${n}` }));
		});
		const store = createHighlightFilters(() => 'lib1');
		await store.loadPresets();
		expect(apiMock.highlightFilters.create).toHaveBeenCalledTimes(HIGHLIGHT_PRESETS.length);
		// 7 attempted, 1 failed → 6 appended
		expect(store.filters).toHaveLength(HIGHLIGHT_PRESETS.length - 1);
	});

	it('loadPresets() sends each preset body to the API', async () => {
		apiMock.highlightFilters.create.mockImplementation((_lib, body) =>
			Promise.resolve(makeFilter({ id: body.name }))
		);
		const store = createHighlightFilters(() => 'lib1');
		await store.loadPresets();
		const sentBodies = apiMock.highlightFilters.create.mock.calls.map((c) => c[1]);
		expect(sentBodies).toEqual(HIGHLIGHT_PRESETS);
	});
});
