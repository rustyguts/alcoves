import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AudioDetectionsPanel from './AudioDetectionsPanel.svelte';
import type { AudioDetection } from '$lib/types/api';
import type { JobStatusButton } from '$lib/utils/job-status-button';

let nextId = 0;
function makeDetection(over: Partial<AudioDetection>): AudioDetection {
	return {
		id: `d-${nextId++}`,
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
	};
}

const detections: AudioDetection[] = [
	makeDetection({ label: 'Speech', score: 0.5, startSeconds: 0, endSeconds: 2 }),
	makeDetection({ label: 'Laughter', score: 0.9, startSeconds: 5, endSeconds: 6 }),
	makeDetection({ label: 'Laughter', score: 0.6, startSeconds: 10, endSeconds: 11 }),
	makeDetection({ label: 'Music', score: 0.3, startSeconds: 2, endSeconds: 3 }),
	makeDetection({ label: 'Hum', score: 0.1, startSeconds: 4, endSeconds: 4 })
];

function renderPanel(over: Record<string, unknown> = {}) {
	return render(AudioDetectionsPanel, { props: { detections, duration: 20, ...over } });
}

describe('AudioDetectionsPanel', () => {
	describe('empty state', () => {
		it('offers the detect CTA when audio detection is available', () => {
			const onrunjob = vi.fn();
			const screen = render(AudioDetectionsPanel, {
				props: { detections: [], duration: 10, canDetectAudio: true, onrunjob }
			});
			expect(screen.container.textContent).toContain('No audio events yet');
			expect(screen.container.textContent).toContain('Detect laughter, applause, music');
			const btn = screen.container.querySelector('button') as HTMLButtonElement;
			expect(btn.textContent).toContain('Detect audio');
			expect(btn.disabled).toBe(false);
			btn.click();
			expect(onrunjob).toHaveBeenCalledTimes(1);
		});

		it('hints at the transcript requirement and disables the CTA when canDetectAudio is false', () => {
			const screen = render(AudioDetectionsPanel, {
				props: { detections: [], duration: 10, onrunjob: vi.fn() }
			});
			expect(screen.container.textContent).toContain(
				'Audio detection needs a completed transcript first'
			);
			const btn = screen.container.querySelector('button') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
		});

		it('reflects jobButton loading state on the CTA', () => {
			const jobButton: JobStatusButton = {
				label: 'Detecting… 40%',
				color: 'warning',
				loading: true,
				disabled: true
			};
			const screen = render(AudioDetectionsPanel, {
				props: { detections: [], duration: 10, canDetectAudio: true, jobButton, onrunjob: vi.fn() }
			});
			const btn = screen.container.querySelector('button') as HTMLButtonElement;
			expect(btn.textContent).toContain('Detecting… 40%');
			expect(btn.disabled).toBe(true);
			expect(btn.getAttribute('aria-busy')).toBe('true');
		});

		it('disables the CTA from jobButton.disabled even when detection is available', () => {
			const jobButton: JobStatusButton = {
				label: 'Detect audio',
				color: 'primary',
				loading: false,
				disabled: true
			};
			const screen = render(AudioDetectionsPanel, {
				props: { detections: [], duration: 10, canDetectAudio: true, jobButton, onrunjob: vi.fn() }
			});
			const btn = screen.container.querySelector('button') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
			expect(btn.getAttribute('aria-busy')).toBeNull();
		});

		it('omits the CTA when onrunjob is not provided', () => {
			const screen = render(AudioDetectionsPanel, {
				props: { detections: [], duration: 10, canDetectAudio: true }
			});
			expect(screen.container.textContent).toContain('No audio events yet');
			expect(screen.container.querySelector('button')).toBeNull();
		});
	});

	describe('buckets', () => {
		it('groups detections into buckets sorted by best score with a labels badge', () => {
			const screen = renderPanel();
			expect(screen.container.textContent).toContain('4 labels');
			expect(screen.container.textContent).toContain('Click a bar to jump to that moment');
			const labels = [...screen.container.querySelectorAll('li span.font-medium')].map(
				(s) => s.textContent
			);
			expect(labels).toEqual(['Laughter', 'Speech', 'Music', 'Hum']);
		});

		it('renders score-tier badge classes and the window count', () => {
			const screen = renderPanel();
			const badges = [...screen.container.querySelectorAll('li .badge')];
			expect(badges.map((b) => b.textContent?.trim())).toEqual(['90%', '50%', '30%', '10%']);
			expect(badges[0]!.className).toContain('preset-tonal-success'); // ≥ .7
			expect(badges[1]!.className).toContain('preset-tonal-primary'); // ≥ .4
			expect(badges[2]!.className).toContain('preset-tonal-warning'); // ≥ .2
			expect(badges[3]!.className).toContain('preset-tonal-surface'); // < .2
			expect(screen.container.textContent).toContain('2×'); // Laughter has two windows
			expect(screen.container.textContent).toContain('1×');
		});
	});

	describe('bar strip', () => {
		it('positions window bars proportionally with score-driven opacity and tier colors', () => {
			const screen = renderPanel();
			const bars = [...screen.container.querySelectorAll('button[title]')] as HTMLButtonElement[];
			expect(bars).toHaveLength(5);
			// bars follow bucket order: Laughter (5s, 10s), Speech, Music, Hum
			const laugh = bars[0]!;
			expect(laugh.style.left).toBe('25%'); // 5 / 20
			expect(laugh.style.width).toBe('5%'); // 1 / 20
			expect(parseFloat(laugh.style.opacity)).toBeCloseTo(0.4 + 0.6 * 0.9, 5);
			expect(laugh.className).toContain('bg-success-500');
			expect(bars[1]!.className).toContain('bg-primary-500'); // Laughter @ .6
			const speech = bars[2]!;
			expect(speech.style.left).toBe('0%');
			expect(speech.style.width).toBe('10%');
			expect(parseFloat(speech.style.opacity)).toBeCloseTo(0.4 + 0.6 * 0.5, 5);
			expect(bars[3]!.className).toContain('bg-warning-500'); // Music @ .3
			expect(bars[4]!.className).toContain('bg-surface-500'); // Hum @ .1
		});

		it('clamps zero-length windows to a minimum bar width', () => {
			const screen = renderPanel();
			const hum = screen.container.querySelector('button[title^="Hum"]') as HTMLButtonElement;
			expect(hum.style.width).toBe('0.5%');
			expect(hum.style.left).toBe('20%'); // 4 / 20
		});

		it('falls back to a full-width bar when duration is not positive', () => {
			const screen = renderPanel({ duration: 0 });
			const bar = screen.container.querySelector('button[title]') as HTMLButtonElement;
			expect(bar.style.left).toBe('0%');
			expect(bar.style.width).toBe('100%');
		});

		it('labels bars with score and start time, falling back to 0:00', () => {
			const screen = renderPanel();
			const laugh = screen.container.querySelector('button[title]') as HTMLButtonElement;
			expect(laugh.title).toBe('Laughter · 90% at 0:05');
			const speech = screen.container.querySelector('button[title^="Speech"]') as HTMLButtonElement;
			expect(speech.title).toBe('Speech · 50% at 0:00'); // formatDuration(0) → null fallback
			expect(speech.getAttribute('aria-label')).toBe('Speech at 0:00');
		});

		it('seeks from a window bar and stops propagation', () => {
			const onseek = vi.fn();
			const screen = renderPanel({ onseek });
			const bar = screen.container.querySelector('button[title]') as HTMLButtonElement;
			// Svelte 5 delegates clicks to the render root, so an ancestor listener
			// can't observe suppression — spy on the event itself instead.
			const event = new MouseEvent('click', { bubbles: true });
			const stop = vi.spyOn(event, 'stopPropagation');
			bar.dispatchEvent(event);
			expect(onseek).toHaveBeenCalledWith(5);
			expect(stop).toHaveBeenCalled();
		});

		it('tolerates a missing onseek handler', () => {
			const screen = renderPanel();
			const bar = screen.container.querySelector('button[title]') as HTMLButtonElement;
			expect(() => bar.click()).not.toThrow();
		});
	});

	describe('expanded buckets', () => {
		it('expands a bucket into per-window chips that seek (and bubble)', async () => {
			const onseek = vi.fn();
			const screen = renderPanel({ onseek });
			const toggle = screen.container.querySelector('li > button') as HTMLButtonElement; // Laughter
			toggle.click();
			await expect.element(screen.getByText('0:10')).toBeInTheDocument();
			await expect.element(screen.getByText('0:05')).toBeInTheDocument();
			const outer = vi.fn();
			screen.container.addEventListener('click', outer);
			(screen.getByText('0:10').element().closest('button') as HTMLButtonElement).click();
			screen.container.removeEventListener('click', outer);
			expect(onseek).toHaveBeenCalledWith(10);
			expect(outer).toHaveBeenCalled(); // chips do not stop propagation
		});

		it('collapses an expanded bucket on a second toggle', async () => {
			const screen = renderPanel();
			const toggle = screen.container.querySelector('li > button') as HTMLButtonElement;
			toggle.click();
			await expect.element(screen.getByText('0:10')).toBeInTheDocument();
			toggle.click();
			await vi.waitFor(() => expect(screen.container.textContent).not.toContain('0:10'));
		});
	});
});
