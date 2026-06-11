import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EditorTopBar from './EditorTopBar.svelte';
import type { LibraryFile } from '$lib/types/api';
import type { JobStatusButton } from '$lib/utils/job-status-button';

function btn(label: string, over: Partial<JobStatusButton> = {}): JobStatusButton {
	return { label, color: 'primary', loading: false, disabled: false, ...over };
}

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
	return { id: 'f1', name: 'episode.mp4', mimeType: 'video/mp4', tags: [], ...over } as LibraryFile;
}

function baseProps(over: Record<string, unknown> = {}) {
	return {
		file: makeFile(),
		transcribing: false,
		transcribeButton: btn('Transcribe'),
		audioDetecting: false,
		audioDetectButton: btn('Detect sounds'),
		canDetectAudio: true,
		waveformGenerating: false,
		waveformButton: btn('Generate waveform'),
		...over
	};
}

function findButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll('button')).find((b) =>
		b.textContent?.includes(label)
	);
}

describe('EditorTopBar', () => {
	it('renders the file name', () => {
		const screen = render(EditorTopBar, { props: baseProps() });
		expect(screen.container.textContent).toContain('episode.mp4');
	});

	it('shows a loading placeholder when the file is missing', () => {
		const nullScreen = render(EditorTopBar, { props: baseProps({ file: null }) });
		expect(nullScreen.container.textContent).toContain('Loading…');
		// No file → not playable → no job buttons or badges either.
		expect(findButton(nullScreen.container, 'Transcribe')).toBeUndefined();
		expect(nullScreen.container.querySelectorAll('.badge')).toHaveLength(0);

		const undefScreen = render(EditorTopBar, { props: baseProps({ file: undefined }) });
		expect(undefScreen.container.textContent).toContain('Loading…');
	});

	it('fires onback when the Back button is clicked', () => {
		const onback = vi.fn();
		const screen = render(EditorTopBar, { props: baseProps({ onback }) });
		screen.container.querySelector<HTMLButtonElement>('[aria-label="Back to library"]')?.click();
		expect(onback).toHaveBeenCalledTimes(1);
	});

	it('shows duration and kind badges for a video with metadata', () => {
		const screen = render(EditorTopBar, { props: baseProps({ file: makeFile({ duration: 90 }) }) });
		const badges = Array.from(screen.container.querySelectorAll('.badge')).map((b) =>
			b.textContent?.trim()
		);
		expect(badges).toEqual(['1:30', 'Video']);
	});

	it('labels audio files with an Audio badge', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({ file: makeFile({ mimeType: 'audio/mpeg', duration: 8 }) })
		});
		const badges = Array.from(screen.container.querySelectorAll('.badge')).map((b) =>
			b.textContent?.trim()
		);
		expect(badges).toEqual(['0:08', 'Audio']);
	});

	it('hides the badges when the file has no duration or recognizable mime', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({
				file: makeFile({ mimeType: 'image/png', duration: undefined }),
				canDetectAudio: false
			})
		});
		expect(screen.container.querySelectorAll('.badge')).toHaveLength(0);
	});

	it('shows the job buttons for a playable file and fires their callbacks', () => {
		const ontranscribe = vi.fn();
		const onaudioDetect = vi.fn();
		const onwaveform = vi.fn();
		const screen = render(EditorTopBar, {
			props: baseProps({ ontranscribe, onaudioDetect, onwaveform })
		});

		findButton(screen.container, 'Transcribe')?.click();
		findButton(screen.container, 'Detect sounds')?.click();
		findButton(screen.container, 'Generate waveform')?.click();

		expect(ontranscribe).toHaveBeenCalledTimes(1);
		expect(onaudioDetect).toHaveBeenCalledTimes(1);
		expect(onwaveform).toHaveBeenCalledTimes(1);
	});

	it('hides the transcribe and waveform buttons for a non-playable file', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({ file: makeFile({ mimeType: 'image/png' }), canDetectAudio: false })
		});
		expect(findButton(screen.container, 'Transcribe')).toBeUndefined();
		expect(findButton(screen.container, 'Generate waveform')).toBeUndefined();
	});

	it('hides the audio-detect button when canDetectAudio is false', () => {
		const screen = render(EditorTopBar, { props: baseProps({ canDetectAudio: false }) });
		expect(findButton(screen.container, 'Detect sounds')).toBeUndefined();
		// The other playable-file actions stay visible.
		expect(findButton(screen.container, 'Transcribe')).toBeDefined();
		expect(findButton(screen.container, 'Generate waveform')).toBeDefined();
	});

	it('uses a filled preset for failed jobs and tonal otherwise', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({
				file: makeFile({ transcribeStatus: 'failed', audioDetectStatus: 'failed' }),
				transcribeButton: btn('Retry transcribe', { color: 'error' }),
				audioDetectButton: btn('Retry detection', { color: 'error' })
			})
		});
		expect(findButton(screen.container, 'Retry transcribe')?.className).toContain(
			'preset-filled-error-500'
		);
		expect(findButton(screen.container, 'Retry detection')?.className).toContain(
			'preset-filled-error-500'
		);
		// The non-failed waveform job keeps the tonal variant.
		expect(findButton(screen.container, 'Generate waveform')?.className).toContain(
			'preset-tonal-primary'
		);
	});

	it('shouts a failed waveform job with the filled preset', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({
				file: makeFile({ waveformStatus: 'failed' }),
				waveformButton: btn('Retry waveform', { color: 'error' })
			})
		});
		expect(findButton(screen.container, 'Retry waveform')?.className).toContain(
			'preset-filled-error-500'
		);
	});

	it('maps the neutral job color onto the surface palette', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({ transcribeButton: btn('Re-transcribe', { color: 'neutral' }) })
		});
		expect(findButton(screen.container, 'Re-transcribe')?.className).toContain(
			'preset-tonal-surface'
		);
	});

	it('passes the loading state through to the buttons', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({
				transcribing: true,
				waveformButton: btn('Generating…', { loading: true })
			})
		});
		const transcribe = findButton(screen.container, 'Transcribe');
		expect(transcribe?.getAttribute('aria-busy')).toBe('true');
		expect(transcribe?.disabled).toBe(true);
		const waveform = findButton(screen.container, 'Generating…');
		expect(waveform?.getAttribute('aria-busy')).toBe('true');
		expect(waveform?.disabled).toBe(true);
	});

	it('disables a job button when its fixture is disabled or its job flag is set', () => {
		const screen = render(EditorTopBar, {
			props: baseProps({
				transcribeButton: btn('Transcribe', { disabled: true }),
				audioDetecting: true
			})
		});
		expect(findButton(screen.container, 'Transcribe')?.disabled).toBe(true);
		expect(findButton(screen.container, 'Detect sounds')?.disabled).toBe(true);
		expect(findButton(screen.container, 'Generate waveform')?.disabled).toBe(false);
	});

	it('fires onopenShortcuts from the keyboard-help button', () => {
		const onopenShortcuts = vi.fn();
		const screen = render(EditorTopBar, { props: baseProps({ onopenShortcuts }) });
		const help = screen.container.querySelector<HTMLButtonElement>(
			'[aria-label="Keyboard shortcuts"]'
		);
		expect(help?.title).toBe('Keyboard shortcuts (?)');
		help?.click();
		expect(onopenShortcuts).toHaveBeenCalledTimes(1);
	});

	it('tolerates missing callbacks on every control', () => {
		const screen = render(EditorTopBar, { props: baseProps() });
		const buttons = Array.from(screen.container.querySelectorAll('button'));
		// back, transcribe, detect, waveform, keyboard help
		expect(buttons).toHaveLength(5);
		for (const b of buttons) b.click();
		expect(screen.container.textContent).toContain('episode.mp4');
	});
});
