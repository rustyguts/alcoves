import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import MarkersTrack from './MarkersTrack.svelte';
import type { TimelineMarker } from '$lib/utils/timeline-geometry';

function makeMarker(over: Partial<TimelineMarker> = {}): TimelineMarker {
	return {
		id: 'mk1',
		filterId: 'f1',
		name: 'Laughter',
		color: 'rgb(255, 0, 0)',
		startSeconds: 2,
		title: 'Laughter · 0:02 · laughter',
		...over
	};
}

describe('MarkersTrack', () => {
	it('renders the Markers label chip even with no markers', async () => {
		const screen = render(MarkersTrack, { props: { markers: [], pxPerSec: 10 } });
		await tick();
		await expect.element(screen.getByText('Markers')).toBeInTheDocument();
		expect(screen.container.querySelectorAll('button')).toHaveLength(0);
	});

	it('renders one positioned, colored button per marker with title and aria-label', async () => {
		const markers = [
			makeMarker(),
			makeMarker({
				id: 'mk2',
				filterId: 'f2',
				name: 'Applause',
				color: 'rgb(0, 128, 0)',
				startSeconds: 5,
				title: 'Applause · 0:05 · applause'
			})
		];
		const screen = render(MarkersTrack, { props: { markers, pxPerSec: 10 } });
		await tick();
		const buttons = screen.container.querySelectorAll('button');
		expect(buttons).toHaveLength(2);
		const first = buttons[0] as HTMLButtonElement;
		expect(first.title).toBe('Laughter · 0:02 · laughter');
		expect(first.getAttribute('aria-label')).toBe('Laughter · 0:02 · laughter');
		expect(first.style.left).toBe('17px'); // 2s * 10px/s − 3px center offset
		expect(first.style.backgroundColor).toBe('rgb(255, 0, 0)');
		const second = buttons[1] as HTMLButtonElement;
		expect(second.style.left).toBe('47px');
		expect(second.style.backgroundColor).toBe('rgb(0, 128, 0)');
	});

	it('exposes the marker title as the accessible name', async () => {
		const screen = render(MarkersTrack, { props: { markers: [makeMarker()], pxPerSec: 10 } });
		await tick();
		await expect
			.element(screen.getByRole('button', { name: 'Laughter · 0:02 · laughter' }))
			.toBeInTheDocument();
	});

	it('clamps the marker position to 0 near the timeline start', async () => {
		const screen = render(MarkersTrack, {
			props: { markers: [makeMarker({ startSeconds: 0 })], pxPerSec: 10 }
		});
		await tick();
		const button = screen.container.querySelector('button') as HTMLButtonElement;
		expect(button.style.left).toBe('0px');
	});

	it('updates marker position, color and labels on rerender', async () => {
		const screen = render(MarkersTrack, { props: { markers: [makeMarker()], pxPerSec: 10 } });
		await tick();
		await screen.rerender({
			markers: [
				makeMarker({ color: 'rgb(0, 0, 255)', startSeconds: 9, title: 'Laughter · 0:09 · giggle' })
			],
			pxPerSec: 10
		});
		await tick();
		const button = screen.container.querySelector('button') as HTMLButtonElement;
		expect(button.style.left).toBe('87px');
		expect(button.style.backgroundColor).toBe('rgb(0, 0, 255)');
		expect(button.title).toBe('Laughter · 0:09 · giggle');
		expect(button.getAttribute('aria-label')).toBe('Laughter · 0:09 · giggle');
	});

	it('clicking a marker seeks to its start and stops propagation', async () => {
		const onseek = vi.fn();
		const parentClick = vi.fn();
		const screen = render(MarkersTrack, {
			props: { markers: [makeMarker({ startSeconds: 2.5 })], pxPerSec: 10, onseek }
		});
		await tick();
		const button = screen.container.querySelector('button') as HTMLButtonElement;
		const track = screen.container.querySelector('[data-testid="markers-track"]') as HTMLElement;
		window.addEventListener('click', parentClick);
		try {
			button.click();
			expect(onseek).toHaveBeenCalledWith(2.5);
			expect(parentClick).not.toHaveBeenCalled();
			// Control: a click on the bare track DOES bubble out, proving the spy works.
			track.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(parentClick).toHaveBeenCalledTimes(1);
		} finally {
			window.removeEventListener('click', parentClick);
		}
	});

	it('survives a marker click without an onseek callback', async () => {
		const screen = render(MarkersTrack, { props: { markers: [makeMarker()], pxPerSec: 10 } });
		await tick();
		const button = screen.container.querySelector('button') as HTMLButtonElement;
		expect(() => button.click()).not.toThrow();
	});
});
