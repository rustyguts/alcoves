import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { MapPoint } from '$lib/types/api';

// Force the client-only guard to no-op: with `browser` false the onMount body
// returns early and never imports Leaflet (which can't initialise in the headless
// test DOM). We're only asserting the component mounts its container cleanly.
vi.mock('$app/environment', () => ({ browser: false }));

import LibraryMap from './LibraryMap.svelte';

const points: MapPoint[] = [
	{ id: 'a', name: 'Alpha', lat: 12, lon: 34, thumbnailFileId: null, capturedAt: null },
	{ id: 'b', name: 'Beta', lat: -5, lon: 67, thumbnailFileId: 'thumb', capturedAt: '2025-01-01' }
];

describe('LibraryMap', () => {
	it('renders a full-size map container without initialising Leaflet', async () => {
		const screen = render(LibraryMap, { props: { points } });
		const container = screen.container.querySelector('div');
		expect(container).not.toBeNull();
		expect(container?.className).toContain('h-full');
		expect(container?.className).toContain('w-full');
		// Guarded: no Leaflet means no tile/marker children get injected.
		expect(container?.querySelector('.leaflet-container')).toBeNull();
	});

	it('renders with an empty point set', async () => {
		const screen = render(LibraryMap, { props: { points: [] } });
		expect(screen.container.querySelector('div')).not.toBeNull();
	});

	it('accepts an onselect callback prop without invoking it on mount', async () => {
		const onselect = vi.fn();
		const screen = render(LibraryMap, { props: { points, onselect } });
		expect(screen.container.querySelector('div')).not.toBeNull();
		// No map means no markers, so the select callback never fires from a render.
		expect(onselect).not.toHaveBeenCalled();
	});
});
