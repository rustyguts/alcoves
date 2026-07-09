import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from '@vitest/browser/context';
import TranscriptPanel from './TranscriptPanel.svelte';
import type { VttCue } from '$lib/utils/parse-vtt';
import type { JobStatusButton } from '$lib/utils/job-status-button';

const cues: VttCue[] = [
	{ startSeconds: 1, endSeconds: 2, text: 'banana banana apple' },
	{ startSeconds: 65, endSeconds: 67, text: 'banana cherry pie' },
	{ startSeconds: 70, endSeconds: 72, text: 'the and of nothing useful b' },
	{ startSeconds: 75, endSeconds: 76, text: '1234 !!!' }
];

function renderPanel(over: Record<string, unknown> = {}) {
	return render(TranscriptPanel, { props: { cues, currentTime: 0, ...over } });
}

type Screen = ReturnType<typeof renderPanel>;

function searchInput(screen: Screen): HTMLInputElement {
	return screen.container.querySelector("input[type='text']") as HTMLInputElement;
}

function setSearch(screen: Screen, value: string) {
	const input = searchInput(screen);
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

function activeRows(screen: Screen): HTMLElement[] {
	return [...screen.container.querySelectorAll('li')].filter((li) =>
		li.className.includes('bg-primary/10')
	);
}

function wordRows(screen: Screen): string[] {
	return [...screen.container.querySelectorAll('ul li button span.font-medium')].map(
		(s) => s.textContent ?? ''
	);
}

async function openTopWords(screen: Screen) {
	const topTab = [...screen.container.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'Top words'
	) as HTMLButtonElement;
	topTab.click();
	await vi.waitFor(() =>
		expect(screen.container.querySelector('[data-slot="select-trigger"]')).not.toBeNull()
	);
}

/**
 * bits-ui's Select opens/selects on pointerdown/pointerup (not click), so a
 * plain DOM `.click()` doesn't work — use the Playwright-backed `userEvent`
 * (real pointer events). Content is portalled to `document.body`.
 */
async function chooseSelect(trigger: HTMLElement, optionText: string) {
	await userEvent.click(trigger);
	const item = await vi.waitFor(() => {
		const found = [...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')].find(
			(el) => el.textContent?.trim() === optionText
		);
		expect(found).toBeDefined();
		return found!;
	});
	await userEvent.click(item);
}

describe('TranscriptPanel', () => {
	describe('empty state', () => {
		it('renders the transcribe CTA and fires onrunjob', async () => {
			const onrunjob = vi.fn();
			const screen = render(TranscriptPanel, { props: { cues: [], currentTime: 0, onrunjob } });
			await expect.element(screen.getByText('No transcript yet')).toBeInTheDocument();
			expect(screen.container.textContent).toContain('nothing leaves your instance');
			const btn = screen.container.querySelector('button') as HTMLButtonElement;
			expect(btn.textContent).toContain('Transcribe');
			expect(btn.disabled).toBe(false);
			btn.click();
			expect(onrunjob).toHaveBeenCalledTimes(1);
		});

		it('switches the description and disables the CTA while the job is loading', () => {
			const jobButton: JobStatusButton = {
				label: 'Transcribing…',
				color: 'warning',
				loading: true,
				disabled: true
			};
			const screen = render(TranscriptPanel, {
				props: { cues: [], currentTime: 0, onrunjob: vi.fn(), jobButton }
			});
			expect(screen.container.textContent).toContain('Transcription is running on this instance');
			const btn = screen.container.querySelector('button') as HTMLButtonElement;
			expect(btn.textContent).toContain('Transcribing…');
			expect(btn.disabled).toBe(true);
			expect(btn.getAttribute('aria-busy')).toBe('true');
		});

		it('disables the CTA from jobButton.disabled without loading', () => {
			const jobButton: JobStatusButton = {
				label: 'Transcribe',
				color: 'primary',
				loading: false,
				disabled: true
			};
			const screen = render(TranscriptPanel, {
				props: { cues: [], currentTime: 0, onrunjob: vi.fn(), jobButton }
			});
			expect(screen.container.textContent).toContain('Transcribe this file locally');
			const btn = screen.container.querySelector('button') as HTMLButtonElement;
			expect(btn.disabled).toBe(true);
			expect(btn.getAttribute('aria-busy')).toBeNull();
		});

		it('omits the CTA when onrunjob is not provided', () => {
			const screen = render(TranscriptPanel, { props: { cues: [], currentTime: 0 } });
			expect(screen.container.textContent).toContain('No transcript yet');
			expect(screen.container.querySelector('button')).toBeNull();
		});
	});

	describe('cue list', () => {
		it('renders the cue list with a count badge and m:ss timestamps', () => {
			const screen = renderPanel();
			expect(screen.container.textContent).toContain('4 cues');
			expect(screen.container.textContent).toContain('banana banana apple');
			expect(screen.container.textContent).toContain('1:05'); // 65s
		});

		it('fires onseek with the cue start when a cue is clicked', () => {
			const onseek = vi.fn();
			const screen = renderPanel({ onseek });
			const cueBtn = [...screen.container.querySelectorAll('ul li button')].find((b) =>
				b.textContent?.includes('banana cherry')
			) as HTMLButtonElement;
			cueBtn.click();
			expect(onseek).toHaveBeenCalledWith(65);
		});

		it('tolerates a missing onseek handler', () => {
			const screen = renderPanel();
			const cueBtn = screen.container.querySelector('ul li button') as HTMLButtonElement;
			expect(() => cueBtn.click()).not.toThrow();
		});

		it('filters cues by search and shows the match count', async () => {
			const screen = renderPanel();
			setSearch(screen, 'cherry');
			await vi.waitFor(() =>
				expect(screen.container.textContent).not.toContain('banana banana apple')
			);
			expect(screen.container.textContent).toContain('banana cherry pie');
			expect(screen.container.textContent).toContain('1/4');
		});

		it('shows a no-match message and clears via the clear button', async () => {
			const screen = renderPanel();
			setSearch(screen, 'zzzz');
			await expect.element(screen.getByText('No matches for "zzzz".')).toBeInTheDocument();
			const clear = screen.container.querySelector(
				"button[aria-label='Clear search']"
			) as HTMLButtonElement;
			clear.click();
			await vi.waitFor(() => expect(searchInput(screen).value).toBe(''));
			expect(screen.container.textContent).toContain('4/4');
		});
	});

	describe('active cue highlight', () => {
		it('highlights the cue covering currentTime', () => {
			const screen = renderPanel({ currentTime: 1.5 });
			const active = activeRows(screen);
			expect(active).toHaveLength(1);
			expect(active[0]!.textContent).toContain('banana banana apple');
		});

		it('computes the active cue against the filtered list', async () => {
			const screen = renderPanel({ currentTime: 66 });
			setSearch(screen, 'cherry');
			await vi.waitFor(() => expect(screen.container.textContent).toContain('1/4'));
			const active = activeRows(screen);
			expect(active).toHaveLength(1);
			expect(active[0]!.textContent).toContain('banana cherry pie');
		});

		it('clears the highlight when the active cue is filtered out', async () => {
			const screen = renderPanel({ currentTime: 1.5 });
			setSearch(screen, 'cherry');
			await vi.waitFor(() => expect(screen.container.textContent).toContain('1/4'));
			expect(activeRows(screen)).toHaveLength(0);
		});
	});

	describe('top words', () => {
		it('ranks non-stopwords by count then alphabetically', async () => {
			const screen = renderPanel();
			await openTopWords(screen);
			expect(wordRows(screen)).toEqual(['banana', 'apple', 'cherry', 'nothing', 'pie', 'useful']);
			const firstRow = screen.container.querySelector('ul li button') as HTMLButtonElement;
			expect(firstRow.textContent).toContain('banana');
			expect(firstRow.textContent).toContain('3');
			// the top word gets a full-width bar
			const bar = firstRow.querySelector('.bg-primary') as HTMLElement;
			expect(bar.style.width).toBe('100%');
			// the cue search box is gone while on the words tab
			expect(screen.container.querySelector("input[type='text']")).toBeNull();
		});

		it('limits the ranking via the Top-N select', async () => {
			const screen = renderPanel();
			await openTopWords(screen);
			expect(wordRows(screen)).toHaveLength(6);
			const trigger = screen.container.querySelector<HTMLElement>('[data-slot="select-trigger"]')!;
			await chooseSelect(trigger, '5');
			await vi.waitFor(() => expect(wordRows(screen)).toHaveLength(5));
			expect(wordRows(screen)).not.toContain('useful');
		});

		it('clicking a word returns to Cues with the search prefilled', async () => {
			const screen = renderPanel();
			await openTopWords(screen);
			const wordBtn = [...screen.container.querySelectorAll('ul li button')].find((b) =>
				b.textContent?.includes('banana')
			) as HTMLButtonElement;
			wordBtn.click();
			await vi.waitFor(() => expect(searchInput(screen).value).toBe('banana'));
			expect(screen.container.textContent).toContain('2/4');
		});

		it('shows "No words to count." when every word is a stopword', async () => {
			const screen = render(TranscriptPanel, {
				props: { cues: [{ startSeconds: 0, endSeconds: 1, text: 'the and of' }], currentTime: 0 }
			});
			const topTab = [...screen.container.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'Top words'
			) as HTMLButtonElement;
			topTab.click();
			await expect.element(screen.getByText('No words to count.')).toBeInTheDocument();
		});
	});
});
