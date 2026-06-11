import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EditorHeader from './EditorHeader.svelte';
import type { LibraryFile } from '$lib/types/api';
import type { JobStatusButton } from '$lib/utils/job-status-button';

const btn = (label: string): JobStatusButton => ({
	label,
	color: 'primary',
	loading: false,
	disabled: false
});

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
	return { id: 'f1', name: 'clip.mp4', mimeType: 'video/mp4', tags: [], ...over } as LibraryFile;
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
	) as HTMLButtonElement | undefined;
}

describe('EditorHeader', () => {
	it('renders the file name', () => {
		const screen = render(EditorHeader, { props: baseProps() });
		expect(screen.container.textContent).toContain('clip.mp4');
	});

	it('shows a loading placeholder when no file', () => {
		const screen = render(EditorHeader, { props: baseProps({ file: null }) });
		expect(screen.container.textContent).toContain('Loading…');
	});

	it('fires onback when the Back button is clicked', () => {
		const onback = vi.fn();
		const screen = render(EditorHeader, { props: baseProps({ onback }) });
		findButton(screen.container, 'Back')?.click();
		expect(onback).toHaveBeenCalledTimes(1);
	});

	it('shows transcribe/audio-detect/waveform actions for a playable file and fires them', () => {
		const ontranscribe = vi.fn();
		const onaudioDetect = vi.fn();
		const onwaveform = vi.fn();
		const screen = render(EditorHeader, {
			props: baseProps({ ontranscribe, onaudioDetect, onwaveform })
		});

		findButton(screen.container, 'Transcribe')?.click();
		findButton(screen.container, 'Detect sounds')?.click();
		findButton(screen.container, 'Generate waveform')?.click();

		expect(ontranscribe).toHaveBeenCalledTimes(1);
		expect(onaudioDetect).toHaveBeenCalledTimes(1);
		expect(onwaveform).toHaveBeenCalledTimes(1);
	});

	it('hides playback actions for a non-playable file', () => {
		const screen = render(EditorHeader, {
			props: baseProps({ file: makeFile({ mimeType: 'image/png' }), canDetectAudio: false })
		});
		expect(screen.container.textContent).not.toContain('Transcribe');
		expect(screen.container.textContent).not.toContain('Generate waveform');
	});

	it('hides the audio-detect action when canDetectAudio is false', () => {
		const screen = render(EditorHeader, { props: baseProps({ canDetectAudio: false }) });
		expect(screen.container.textContent).not.toContain('Detect sounds');
	});

	it('disables an action button when its job button is disabled or in-flight', () => {
		const screen = render(EditorHeader, {
			props: baseProps({
				transcribeButton: { ...btn('Transcribe'), disabled: true },
				audioDetecting: true
			})
		});
		expect(findButton(screen.container, 'Transcribe')?.disabled).toBe(true);
		expect(findButton(screen.container, 'Detect sounds')?.disabled).toBe(true);
		expect(findButton(screen.container, 'Generate waveform')?.disabled).toBe(false);
	});

	it('uses a tonal preset normally and a filled preset for a failed job', () => {
		const screen = render(EditorHeader, {
			props: baseProps({
				file: makeFile({ transcribeStatus: 'failed' }),
				transcribeButton: {
					label: 'Retry transcribe',
					color: 'error',
					loading: false,
					disabled: false
				}
			})
		});
		const transcribe = findButton(screen.container, 'Retry transcribe');
		expect(transcribe?.className).toContain('preset-filled-error-500');
		// A non-failed job keeps the tonal variant.
		const waveform = findButton(screen.container, 'Generate waveform');
		expect(waveform?.className).toContain('preset-tonal-primary');
	});
});
