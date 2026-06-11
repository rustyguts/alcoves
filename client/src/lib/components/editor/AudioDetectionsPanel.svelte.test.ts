import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AudioDetectionsPanel from './AudioDetectionsPanel.svelte';
import type { AudioDetection } from '$lib/types/api';

function makeDetection(over: Partial<AudioDetection>): AudioDetection {
	return {
		id: `d-${Math.round((over.startSeconds ?? 0) * 100)}-${over.label ?? 'x'}`,
		fileId: 'f',
		libraryId: 'lib',
		label: 'Laughter',
		classIndex: 1,
		score: 0.8,
		startSeconds: 0,
		endSeconds: 1,
		version: 1,
		createdAt: '',
		...over
	} as AudioDetection;
}

const detections = [
	makeDetection({ label: 'Speech', score: 0.5, startSeconds: 0, endSeconds: 2 }),
	makeDetection({ label: 'Laughter', score: 0.9, startSeconds: 5, endSeconds: 6 }),
	makeDetection({ label: 'Laughter', score: 0.6, startSeconds: 10, endSeconds: 11 })
];

function renderPanel(over: Record<string, unknown> = {}) {
	return render(AudioDetectionsPanel, { props: { detections, duration: 20, ...over } });
}

describe('AudioDetectionsPanel', () => {
	it('renders nothing when there are no detections', () => {
		const screen = render(AudioDetectionsPanel, { props: { detections: [], duration: 10 } });
		expect(screen.container.textContent?.trim()).toBe('');
	});

	it('shows the header with a label-bucket count', () => {
		const screen = renderPanel();
		expect(screen.container.textContent).toContain('Audio events');
		expect(screen.container.textContent).toContain('2 labels');
	});

	it('is collapsed by default and expands on header click', async () => {
		const screen = renderPanel();
		expect(screen.container.textContent).not.toContain('Laughter');
		screen.container.querySelectorAll('button')[0]!.click();
		await expect.element(screen.getByText('Laughter')).toBeInTheDocument();
		expect(screen.container.textContent).toContain('Speech');
	});

	it('orders buckets by best score (Laughter 90% before Speech 50%)', async () => {
		const screen = renderPanel();
		screen.container.querySelectorAll('button')[0]!.click();
		await expect.element(screen.getByText('Laughter')).toBeInTheDocument();
		const labels = [...screen.container.querySelectorAll('li > button span.font-medium')].map(
			(s) => s.textContent
		);
		expect(labels[0]).toBe('Laughter');
		expect(labels[1]).toBe('Speech');
	});

	it('fires onseek with the window start when a timeline bar is clicked', async () => {
		const onseek = vi.fn();
		const screen = renderPanel({ onseek });
		screen.container.querySelectorAll('button')[0]!.click();
		await expect.element(screen.getByText('Laughter')).toBeInTheDocument();
		// first timeline bar belongs to the top bucket (Laughter, best window @ 5s)
		const bar = screen.container.querySelector('button[title]') as HTMLButtonElement;
		bar.click();
		expect(onseek).toHaveBeenCalledWith(5);
	});

	it('expands a bucket to reveal its window chips and seeks from them', async () => {
		const onseek = vi.fn();
		const screen = renderPanel({ onseek });
		screen.container.querySelectorAll('button')[0]!.click(); // open panel
		await expect.element(screen.getByText('Laughter')).toBeInTheDocument();
		// first bucket (Laughter) toggle button
		const bucketBtn = screen.container.querySelectorAll('li > button')[0] as HTMLButtonElement;
		bucketBtn.click();
		// chips show the two Laughter windows (5s and 10s)
		await expect.element(screen.getByText('0:05')).toBeInTheDocument();
		await expect.element(screen.getByText('0:10')).toBeInTheDocument();
		// clicking a chip seeks
		screen.getByText('0:10').element().closest('button')!.click();
		expect(onseek).toHaveBeenCalledWith(10);
	});

	it('treats a non-positive duration as a full-width bar without throwing', async () => {
		const screen = renderPanel({ duration: 0 });
		expect(screen.container.textContent).toContain('Audio events');
		// header is rendered; collapsed by default so no bars yet — toggle to render them
		screen.container.querySelectorAll('button')[0]!.click();
		await expect.element(screen.getByText('Laughter')).toBeInTheDocument();
		const bar = screen.container.querySelector('button[title]') as HTMLButtonElement | null;
		expect(bar?.getAttribute('style')).toContain('width: 100%');
	});
});
