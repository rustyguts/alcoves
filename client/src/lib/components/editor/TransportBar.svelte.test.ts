import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TransportBar from './TransportBar.svelte';

function baseProps(over: Record<string, unknown> = {}) {
	return {
		currentTime: 1.5,
		duration: 6,
		paused: true,
		rate: 1,
		loop: false,
		muted: false,
		volume: 0.8,
		hasSelection: false,
		...over
	};
}

function button(container: ParentNode, label: string): HTMLButtonElement | null {
	return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

describe('TransportBar', () => {
	it('shows a Play control when paused and Pause when playing', () => {
		const pausedScreen = render(TransportBar, { props: baseProps({ paused: true }) });
		const play = button(pausedScreen.container, 'Play');
		expect(play).not.toBeNull();
		expect(play?.title).toBe('Play (Space)');
		expect(button(pausedScreen.container, 'Pause')).toBeNull();

		const playingScreen = render(TransportBar, { props: baseProps({ paused: false }) });
		const pause = button(playingScreen.container, 'Pause');
		expect(pause).not.toBeNull();
		expect(pause?.title).toBe('Pause (Space)');
		expect(button(playingScreen.container, 'Play')).toBeNull();
	});

	it('formats the timecode to tenths', async () => {
		const screen = render(TransportBar, { props: baseProps() });
		await expect
			.element(screen.getByTestId('transport-timecode'))
			.toHaveTextContent('0:01.5 / 0:06.0');
	});

	it('forces hour formatting when the duration reaches an hour', async () => {
		const screen = render(TransportBar, {
			props: baseProps({ currentTime: 65, duration: 3600 })
		});
		await expect
			.element(screen.getByTestId('transport-timecode'))
			.toHaveTextContent('0:01:05.0 / 1:00:00.0');
	});

	it('fires onjump with ±5 seconds from the jump buttons', () => {
		const onjump = vi.fn();
		const screen = render(TransportBar, { props: baseProps({ onjump }) });
		button(screen.container, 'Back 5 seconds')?.click();
		button(screen.container, 'Forward 5 seconds')?.click();
		expect(onjump).toHaveBeenCalledTimes(2);
		expect(onjump).toHaveBeenNthCalledWith(1, -5);
		expect(onjump).toHaveBeenNthCalledWith(2, 5);
	});

	it('fires onstepframe with ±1 from the frame-step buttons', () => {
		const onstepframe = vi.fn();
		const screen = render(TransportBar, { props: baseProps({ onstepframe }) });
		const back = button(screen.container, 'Step back one frame');
		const forward = button(screen.container, 'Step forward one frame');
		expect(back?.title).toContain('~1 frame');
		expect(forward?.title).toContain('~1 frame');
		back?.click();
		forward?.click();
		expect(onstepframe).toHaveBeenNthCalledWith(1, -1);
		expect(onstepframe).toHaveBeenNthCalledWith(2, 1);
	});

	it('fires ontoggleplay, ontogglemute and onfullscreen', () => {
		const ontoggleplay = vi.fn();
		const ontogglemute = vi.fn();
		const onfullscreen = vi.fn();
		const screen = render(TransportBar, {
			props: baseProps({ ontoggleplay, ontogglemute, onfullscreen })
		});
		button(screen.container, 'Play')?.click();
		button(screen.container, 'Mute')?.click();
		button(screen.container, 'Fullscreen')?.click();
		expect(ontoggleplay).toHaveBeenCalledTimes(1);
		expect(ontogglemute).toHaveBeenCalledTimes(1);
		expect(onfullscreen).toHaveBeenCalledTimes(1);
	});

	it('reflects the rate prop and fires onsetrate with a number', async () => {
		const onsetrate = vi.fn();
		const screen = render(TransportBar, { props: baseProps({ rate: 1.25, onsetrate }) });
		const select = screen.container.querySelector<HTMLSelectElement>(
			'select[aria-label="Playback rate"]'
		);
		expect(select?.value).toBe('1.25');
		select!.value = '1.5';
		select!.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onsetrate).toHaveBeenCalledTimes(1);
		expect(onsetrate).toHaveBeenCalledWith(1.5);

		// A rate pushed back down from the player updates the select.
		await screen.rerender({ rate: 2 });
		expect(select?.value).toBe('2');
	});

	it('lists every playback rate with an × label', () => {
		const screen = render(TransportBar, { props: baseProps() });
		const options = Array.from(screen.container.querySelectorAll('option'));
		expect(options.map((o) => o.textContent?.trim())).toEqual([
			'0.25×',
			'0.5×',
			'0.75×',
			'1×',
			'1.25×',
			'1.5×',
			'2×'
		]);
	});

	it('disables the loop toggle without a selection', () => {
		const screen = render(TransportBar, { props: baseProps({ hasSelection: false }) });
		const loop = button(screen.container, 'Loop selected moment');
		expect(loop?.disabled).toBe(true);
		expect(loop?.getAttribute('aria-pressed')).toBe('false');
		expect(loop?.title).toBe('Loop selected moment (R)');
	});

	it('arms the loop toggle with primary styling and fires ontoggleloop', () => {
		const ontoggleloop = vi.fn();
		const screen = render(TransportBar, {
			props: baseProps({ hasSelection: true, loop: true, ontoggleloop })
		});
		const loop = button(screen.container, 'Loop selected moment');
		expect(loop?.disabled).toBe(false);
		expect(loop?.getAttribute('aria-pressed')).toBe('true');
		expect(loop?.getAttribute('data-state')).toBe('on');
		loop?.click();
		expect(ontoggleloop).toHaveBeenCalledTimes(1);
	});

	it('keeps the loop toggle in the off state when not looping', () => {
		const screen = render(TransportBar, {
			props: baseProps({ hasSelection: true, loop: false })
		});
		expect(button(screen.container, 'Loop selected moment')?.getAttribute('data-state')).toBe(
			'off'
		);
	});

	it('swaps the mute control to Unmute when muted or volume is zero', () => {
		const audible = render(TransportBar, { props: baseProps() });
		expect(button(audible.container, 'Mute')).not.toBeNull();
		expect(button(audible.container, 'Unmute')).toBeNull();

		const muted = render(TransportBar, { props: baseProps({ muted: true }) });
		expect(button(muted.container, 'Unmute')).not.toBeNull();
		expect(button(muted.container, 'Mute')).toBeNull();

		const silent = render(TransportBar, { props: baseProps({ volume: 0 }) });
		expect(button(silent.container, 'Unmute')).not.toBeNull();
	});

	it('reflects the volume prop and fires onsetvolume from the slider', () => {
		const onsetvolume = vi.fn();
		const screen = render(TransportBar, { props: baseProps({ onsetvolume }) });
		const slider = screen.container.querySelector<HTMLInputElement>('input[aria-label="Volume"]');
		expect(slider?.value).toBe('0.8');
		slider!.value = '0.35';
		slider!.dispatchEvent(new Event('input', { bubbles: true }));
		expect(onsetvolume).toHaveBeenCalledTimes(1);
		expect(onsetvolume).toHaveBeenCalledWith(0.35);
	});

	it('hides the fullscreen control for audio files', () => {
		const video = render(TransportBar, { props: baseProps() });
		expect(button(video.container, 'Fullscreen')).not.toBeNull();

		const audio = render(TransportBar, { props: baseProps({ isAudio: true }) });
		expect(button(audio.container, 'Fullscreen')).toBeNull();
	});

	it('tolerates missing callbacks on every control', () => {
		const screen = render(TransportBar, { props: baseProps({ hasSelection: true }) });
		const buttons = Array.from(screen.container.querySelectorAll('button'));
		// jump ×2, step ×2, play, loop, mute, fullscreen
		expect(buttons).toHaveLength(8);
		for (const b of buttons) b.click();
		const select = screen.container.querySelector<HTMLSelectElement>('select');
		select!.value = '2';
		select!.dispatchEvent(new Event('change', { bubbles: true }));
		const slider = screen.container.querySelector<HTMLInputElement>('input[type="range"]');
		slider!.value = '0.5';
		slider!.dispatchEvent(new Event('input', { bubbles: true }));
		expect(screen.container.querySelector('[data-testid="transport-timecode"]')).not.toBeNull();
	});
});
