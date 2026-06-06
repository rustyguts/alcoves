import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TranscriptPanel from './TranscriptPanel.svelte';
import type { VttCue } from '$lib/utils/parse-vtt';

const cues: VttCue[] = [
	{ startSeconds: 1, endSeconds: 2, text: 'banana banana apple' },
	{ startSeconds: 65, endSeconds: 67, text: 'banana cherry pie' },
	{ startSeconds: 70, endSeconds: 72, text: 'nothing useful here' }
];

function renderPanel(over: Record<string, unknown> = {}) {
	return render(TranscriptPanel, { props: { cues, currentTime: 0, ...over } });
}

describe('TranscriptPanel', () => {
	it('renders nothing when there are no cues', () => {
		const screen = render(TranscriptPanel, { props: { cues: [], currentTime: 0 } });
		expect(screen.container.textContent?.trim()).toBe('');
	});

	it('renders the header with a cue count and the cue text', () => {
		const screen = renderPanel();
		expect(screen.container.textContent).toContain('Transcript');
		expect(screen.container.textContent).toContain('3 cues');
		expect(screen.container.textContent).toContain('banana banana apple');
	});

	it('formats cue timestamps as m:ss', () => {
		const screen = renderPanel();
		expect(screen.container.textContent).toContain('1:05'); // 65s
	});

	it('fires onseek with the cue start when a cue is clicked', async () => {
		const onseek = vi.fn();
		const screen = renderPanel({ onseek });
		const cueBtn = [...screen.container.querySelectorAll('ul li button')].find((b) =>
			b.textContent?.includes('banana banana')
		) as HTMLButtonElement;
		cueBtn.click();
		expect(onseek).toHaveBeenCalledWith(1);
	});

	it('filters cues by the search box and shows the match count', async () => {
		const screen = renderPanel();
		const input = screen.container.querySelector("input[type='text']") as HTMLInputElement;
		input.value = 'cherry';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await expect.element(screen.getByText('banana cherry pie')).toBeInTheDocument();
		expect(screen.container.textContent).not.toContain('nothing useful here');
		expect(screen.container.textContent).toContain('1/3');
	});

	it('shows a no-match message and clears the search', async () => {
		const screen = renderPanel();
		const input = screen.container.querySelector("input[type='text']") as HTMLInputElement;
		input.value = 'zzzz';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await expect.element(screen.getByText('No matches for "zzzz".')).toBeInTheDocument();
		const clear = screen.container.querySelector(
			"button[aria-label='Clear search']"
		) as HTMLButtonElement;
		clear.click();
		await vi.waitFor(() => expect(input.value).toBe(''));
	});

	it('highlights the active cue based on currentTime', () => {
		const screen = renderPanel({ currentTime: 1.5 });
		expect(screen.container.innerHTML).toContain('border-primary-500');
	});

	it('collapses and re-expands the panel from the header', async () => {
		const screen = renderPanel();
		const header = screen.container.querySelectorAll('button')[0]!;
		// expanded by default: the search box is visible
		expect(screen.container.querySelector("input[type='text']")).not.toBeNull();
		header.click();
		await vi.waitFor(() => expect(screen.container.querySelector("input[type='text']")).toBeNull());
		// header + count still rendered while collapsed
		expect(screen.container.textContent).toContain('3 cues');
		header.click();
		await vi.waitFor(() =>
			expect(screen.container.querySelector("input[type='text']")).not.toBeNull()
		);
	});

	it('switches to the Top words tab and ranks non-stopwords', async () => {
		const screen = renderPanel();
		const topTab = [...screen.container.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Top words'
		) as HTMLButtonElement;
		topTab.click();
		await expect.element(screen.getByText('banana')).toBeInTheDocument();
		expect(screen.container.textContent).toContain('cherry');
		expect(screen.container.textContent).toContain('useful');
		// we're on the words tab — the cue search box is gone
		expect(screen.container.querySelector("input[type='text']")).toBeNull();
	});

	it('clicking a top word filters cues back on the Cues tab', async () => {
		const screen = renderPanel();
		const topTab = [...screen.container.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Top words'
		) as HTMLButtonElement;
		topTab.click();
		await expect.element(screen.getByText('banana')).toBeInTheDocument();
		const wordBtn = [...screen.container.querySelectorAll('ul li button')].find((b) =>
			b.textContent?.includes('banana')
		) as HTMLButtonElement;
		wordBtn.click();
		// back on cues tab, search prefilled with the word
		await vi.waitFor(() => {
			const input = screen.container.querySelector("input[type='text']") as HTMLInputElement | null;
			expect(input?.value).toBe('banana');
		});
	});

	it('lets the user change how many top words are shown', async () => {
		const screen = renderPanel();
		const topTab = [...screen.container.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Top words'
		) as HTMLButtonElement;
		topTab.click();
		await expect.element(screen.getByText('banana')).toBeInTheDocument();
		const select = screen.container.querySelector('select') as HTMLSelectElement;
		expect(select).not.toBeNull();
		select.value = '5';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => expect(select.value).toBe('5'));
	});
});
