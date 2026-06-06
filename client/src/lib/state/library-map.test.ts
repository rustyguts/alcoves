import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.hoisted(() => ({ libraries: { map: vi.fn() } }));
vi.mock('$lib/api', () => ({ api: apiMock }));

import { createLibraryMap } from './library-map.svelte';
import type { LibraryMapResponse, MapPoint } from '$lib/types/api';

const mockMap = apiMock.libraries.map;

function makePoint(id: string, over: Partial<MapPoint> = {}): MapPoint {
	return {
		id,
		name: id,
		lat: 37.78,
		lon: -122.4,
		thumbnailFileId: null,
		capturedAt: null,
		...over
	};
}

beforeEach(() => {
	mockMap.mockReset();
});

describe('createLibraryMap', () => {
	it('starts with empty state', () => {
		const m = createLibraryMap();
		expect(m.points).toEqual([]);
		expect(m.truncated).toBe(false);
		expect(m.loading).toBe(false);
		expect(m.error).toBeNull();
	});

	it('load populates points and truncated flag', async () => {
		mockMap.mockResolvedValueOnce({
			points: [makePoint('a'), makePoint('b')],
			truncated: true
		} satisfies LibraryMapResponse);

		const m = createLibraryMap();
		await m.load('lib-1');

		expect(m.points.map((p) => p.id)).toEqual(['a', 'b']);
		expect(m.truncated).toBe(true);
		expect(m.error).toBeNull();
		expect(mockMap).toHaveBeenCalledWith('lib-1');
	});

	it('captures error message on failed load', async () => {
		mockMap.mockRejectedValueOnce(new Error('nope'));

		const m = createLibraryMap();
		await m.load('lib-1');

		expect(m.error).toBe('nope');
		expect(m.points).toHaveLength(0);
		expect(m.truncated).toBe(false);
		expect(m.loading).toBe(false);
	});

	it('sets loading true while in flight and false after resolve', async () => {
		let resolve!: (v: LibraryMapResponse) => void;
		mockMap.mockReturnValueOnce(
			new Promise<LibraryMapResponse>((r) => {
				resolve = r;
			})
		);

		const m = createLibraryMap();
		const p = m.load('lib-1');
		expect(m.loading).toBe(true);

		resolve({ points: [makePoint('x')], truncated: false });
		await p;
		expect(m.loading).toBe(false);
		expect(m.points.map((pt) => pt.id)).toEqual(['x']);
	});

	it('clears a previous error on a subsequent successful load', async () => {
		const m = createLibraryMap();

		mockMap.mockRejectedValueOnce(new Error('boom'));
		await m.load('lib-1');
		expect(m.error).toBe('boom');

		mockMap.mockResolvedValueOnce({
			points: [makePoint('z')],
			truncated: false
		} satisfies LibraryMapResponse);
		await m.load('lib-1');

		expect(m.error).toBeNull();
		expect(m.points.map((p) => p.id)).toEqual(['z']);
		expect(m.truncated).toBe(false);
	});
});
